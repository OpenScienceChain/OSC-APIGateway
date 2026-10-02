import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import { ShowcaseService } from './showcase.service';
import {
  MAGNETIC_ARCH_MARKER,
  MAGNETIC_ARCH_ORGANIZATION_ID,
  RESEARCH_EXAMPLES,
} from './showcase.constants';

const artifactId = '11111111-1111-4111-8111-111111111111';
const workflowId = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    title: 'Magnetic arch S0',
    description: 'Measurements from the source dataset',
    visibility: RecordVisibility.PUBLIC,
    keywords: [MAGNETIC_ARCH_MARKER, 'plasma'],
    manifest: [{ filename: 'S0_0deg.csv', hash, algorithm: 'sha256' }],
    footprint: hash,
    submissionState: SubmissionState.SUCCESS,
    blockchainTxId: 'fabric-tx-1',
    submitterEmail: 'private@example.test',
    submitterUsername: 'private-user',
    ...overrides,
  };
}

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: workflowId,
    title: 'Magnetic arch measurement workflow',
    description: 'A set of curated measurements',
    keywords: [MAGNETIC_ARCH_MARKER],
    visibility: RecordVisibility.PUBLIC,
    submissionState: SubmissionState.SUCCESS,
    blockchainTxId: 'fabric-workflow-tx',
    artifacts: [artifact()],
    submitterEmail: 'private@example.test',
    ...overrides,
  };
}

describe('ShowcaseService', () => {
  const artifacts = { find: jest.fn(), findOne: jest.fn() };
  const workflows = { find: jest.fn(), findOne: jest.fn() };
  const historyWorker = { fetchHistory: jest.fn() };
  const service = new ShowcaseService(
    artifacts as any,
    workflows as any,
    historyWorker as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('lists only marked public records from the fixed organization without identities', async () => {
    artifacts.find.mockResolvedValue([
      artifact(),
      artifact({ id: 'private', keywords: ['other'] }),
    ]);
    workflows.find.mockResolvedValue([workflow()]);
    const result = await service.list();

    expect(artifacts.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization: { id: MAGNETIC_ARCH_ORGANIZATION_ID },
          visibility: RecordVisibility.PUBLIC,
        }),
      }),
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.workflows).toHaveLength(1);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(result)).not.toContain('private-user');
    expect(JSON.stringify(result)).not.toContain(MAGNETIC_ARCH_MARKER);
  });

  it('rejects unmarked or non-public artifact details', async () => {
    artifacts.findOne
      .mockResolvedValueOnce(artifact({ keywords: [] }))
      .mockResolvedValueOnce(null);
    await expect(service.artifact(artifactId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.artifact(artifactId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(artifacts.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization: { id: MAGNETIC_ARCH_ORGANIZATION_ID },
          visibility: RecordVisibility.PUBLIC,
        }),
      }),
    );
  });

  it('labels measurement angles and the Faraday Cup from reviewed filenames', async () => {
    artifacts.findOne.mockResolvedValue(
      artifact({
        manifest: [
          { filename: 'DB_0_deg.csv', hash, algorithm: 'sha256' },
          { filename: 'S0_-20deg_1.csv', hash, algorithm: 'sha256' },
          { filename: 'DA_FC.txt', hash, algorithm: 'sha256' },
        ],
      }),
    );
    const result = await service.artifact(artifactId);
    expect(result.manifest).toEqual([
      {
        filename: 'DB_0_deg.csv',
        hash,
        algorithm: 'sha256',
        probe: 'RPA',
        angleDegrees: 0,
      },
      {
        filename: 'S0_-20deg_1.csv',
        hash,
        algorithm: 'sha256',
        probe: 'RPA',
        angleDegrees: -20,
      },
      {
        filename: 'DA_FC.txt',
        hash,
        algorithm: 'sha256',
        probe: 'FC',
        angleDegrees: null,
      },
    ]);
  });

  it('requires confirmation before fetching ledger history', async () => {
    artifacts.findOne.mockResolvedValue(
      artifact({ submissionState: SubmissionState.PENDING }),
    );
    await expect(
      service.history('artifact', artifactId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(historyWorker.fetchHistory).not.toHaveBeenCalled();
  });

  it('sanitizes Fabric history to hashes and transaction evidence', async () => {
    artifacts.findOne.mockResolvedValue(artifact());
    historyWorker.fetchHistory.mockResolvedValue({
      items: [
        {
          transactionId: 'fabric-tx-1',
          committedAt: '2024-10-24T10:00:00Z',
          record: {
            revision: 1,
            lastModifiedBy: 'private-user',
            payload: {
              footprint: hash,
              manifest: [
                { filename: 'S0_0deg.csv', hash, algorithm: 'sha256' },
                { filename: '../secret.txt', hash, algorithm: 'sha256' },
              ],
            },
          },
        },
      ],
      hasMore: false,
    });
    const result = await service.history('artifact', artifactId);
    expect(historyWorker.fetchHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: MAGNETIC_ARCH_ORGANIZATION_ID,
        assetType: 'artifact',
      }),
      expect.any(String),
    );
    expect(result.items).toEqual([
      {
        txId: 'fabric-tx-1',
        timestamp: '2024-10-24T10:00:00Z',
        revision: 1,
        snapshot: {
          footprint: hash,
          manifest: [
            {
              filename: 'S0_0deg.csv',
              hash,
              algorithm: 'sha256',
              probe: 'RPA',
              angleDegrees: 0,
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private-user');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('omits private and uncurated artifact IDs from workflow history', async () => {
    workflows.findOne.mockResolvedValue(workflow());
    artifacts.find.mockResolvedValue([artifact()]);
    historyWorker.fetchHistory.mockResolvedValue({
      items: [
        {
          transactionId: 'fabric-workflow-tx',
          committedAt: '2024-10-24T10:00:00Z',
          record: {
            revision: 1,
            payload: {
              artifactIds: [artifactId, '33333333-3333-4333-8333-333333333333'],
            },
          },
        },
      ],
    });

    const result = await service.history('workflow', workflowId);
    expect(result.items[0].snapshot).toEqual({ artifactIds: [artifactId] });
    expect(JSON.stringify(result)).not.toContain('33333333');
  });

  it('propagates data errors while omitting missing linked artifacts', async () => {
    workflows.findOne.mockResolvedValue(workflow());
    artifacts.findOne.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.workflow(workflowId)).rejects.toThrow(
      'database unavailable',
    );
    artifacts.findOne.mockResolvedValueOnce(null);
    const result = await service.workflow(workflowId);
    expect(result.artifactIds).toEqual([]);
  });

  it('isolates each public catalog to its fixed curator and organization', async () => {
    const eeg = RESEARCH_EXAMPLES[1];
    const source = artifact({
      title: 'EEG Eye State - original recording',
      submitterUsername: eeg.curatorUsername,
      keywords: [eeg.marker, 'EEG'],
      manifest: [{ filename: 'EEG Eye State.arff', hash, algorithm: 'sha256' }],
    });
    artifacts.find.mockImplementation(async ({ where }) =>
      where.organization.id === eeg.organizationId
        ? [source, artifact({ id: 'other', keywords: [eeg.marker] })]
        : [],
    );
    workflows.find.mockImplementation(async ({ where }) =>
      where.organization.id === eeg.organizationId
        ? [
            workflow({
              keywords: [eeg.marker],
              submitterUsername: eeg.curatorUsername,
              artifacts: [source],
            }),
          ]
        : [],
    );

    const result = await service.examples();
    expect(result.examples).toHaveLength(3);
    expect(result.examples[1].ready).toBe(true);
    expect(result.examples[1].artifacts).toHaveLength(1);
    expect(result.examples[1].artifacts[0].manifest[0]).toMatchObject({
      probe: null,
      angleDegrees: null,
    });
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(result)).not.toContain(eeg.marker);
  });

  it('rejects an artifact tagged for the example but submitted by another account', async () => {
    const eeg = RESEARCH_EXAMPLES[1];
    artifacts.findOne.mockResolvedValue(artifact({ keywords: [eeg.marker] }));
    await expect(
      service.exampleArtifact(eeg.key, artifactId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(artifacts.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization: { id: eeg.organizationId },
        }),
      }),
    );
  });

  it('rejects unknown example keys before querying records', async () => {
    await expect(
      service.exampleArtifact('unknown', artifactId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(artifacts.findOne).not.toHaveBeenCalled();
  });
});
