import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { ArtifactEntity, ManifestItem } from '../artifact/artifact.entity';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { GhwService } from '../artifact/ghw.service';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import { WorkflowEntity } from '../workflow/workflow.entity';
import {
  MAGNETIC_ARCH_SOURCE,
  RESEARCH_EXAMPLES,
  ResearchExampleConfig,
} from './showcase.constants';

type ShowcaseAssetType = 'artifact' | 'workflow';
type ShowcaseMeasurement = ManifestItem & {
  probe: 'RPA' | 'FC' | null;
  angleDegrees: number | null;
};

const magneticExample = RESEARCH_EXAMPLES[0];

@Injectable()
export class ShowcaseService {
  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifacts: Repository<ArtifactEntity>,
    @InjectRepository(WorkflowEntity)
    private readonly workflows: Repository<WorkflowEntity>,
    private readonly historyWorker: GhwService,
  ) {}

  private isCurated(
    record: { keywords?: string[]; submitterUsername?: string },
    example: ResearchExampleConfig = magneticExample,
  ): boolean {
    return (
      Array.isArray(record.keywords) &&
      record.keywords.includes(example.marker) &&
      (!example.curatorUsername ||
        record.submitterUsername === example.curatorUsername)
    );
  }

  private isConfirmed(record: {
    submissionState: SubmissionState;
    blockchainTxId?: string;
  }): boolean {
    return (
      record.submissionState === SubmissionState.SUCCESS &&
      typeof record.blockchainTxId === 'string' &&
      record.blockchainTxId.trim().length > 0
    );
  }

  private publicManifest(
    manifest: ManifestItem[],
    example: ResearchExampleConfig = magneticExample,
  ): ShowcaseMeasurement[] {
    if (!Array.isArray(manifest)) return [];
    return manifest.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.filename !== 'string' ||
        !/^[A-Za-z0-9_ .-]{1,100}\.(?:csv|txt|arff)$/i.test(entry.filename) ||
        typeof entry.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.hash) ||
        entry.algorithm?.toLowerCase() !== 'sha256'
      )
        return [];
      const angle = /_(-?\d+)_?deg(?:_\d+)?\.csv$/i.exec(entry.filename);
      return [
        {
          filename: entry.filename,
          hash: entry.hash,
          algorithm: 'sha256',
          probe:
            example.key === 'magnetic-arch'
              ? entry.filename.endsWith('_FC.txt')
                ? 'FC'
                : 'RPA'
              : null,
          angleDegrees:
            example.key === 'magnetic-arch' && angle ? Number(angle[1]) : null,
        },
      ];
    });
  }

  private artifactShape(
    artifact: ArtifactEntity,
    example: ResearchExampleConfig = magneticExample,
  ) {
    return {
      id: artifact.id,
      title: artifact.title,
      description: artifact.description,
      organizationSlug: example.organizationSlug,
      submissionState: artifact.submissionState,
      submittedAt: artifact.submittedAt,
      updatedAt: artifact.updatedAt,
      blockchainTxId: this.isConfirmed(artifact)
        ? artifact.blockchainTxId
        : null,
      footprint: /^[a-f0-9]{64}$/.test(artifact.footprint || '')
        ? artifact.footprint
        : null,
      manifest: this.publicManifest(artifact.manifest, example),
      keywords: (artifact.keywords || []).filter(
        (keyword) => keyword !== example.marker,
      ),
      links: artifact.links || [],
      dois: artifact.dois || [],
      fundingAgencies: artifact.fundingAgencies || [],
      acknowledgements: artifact.acknowledgements || '',
      submissionComment: artifact.submission_comment,
    };
  }

  private workflowShape(
    workflow: WorkflowEntity,
    artifactIds: string[],
    example: ResearchExampleConfig = magneticExample,
  ) {
    return {
      id: workflow.id,
      title: workflow.title,
      description: workflow.description,
      organizationSlug: example.organizationSlug,
      submissionState: workflow.submissionState,
      submittedAt: workflow.submittedAt,
      updatedAt: workflow.updatedAt,
      blockchainTxId: this.isConfirmed(workflow)
        ? workflow.blockchainTxId
        : null,
      artifactIds,
      keywords: (workflow.keywords || []).filter(
        (keyword) => keyword !== example.marker,
      ),
      submissionComment: workflow.submission_comment,
    };
  }

  private assertId(id: string): void {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        id,
      )
    ) {
      throw new NotFoundException('Showcase record not found');
    }
  }

  private exampleFor(key: string): ResearchExampleConfig {
    const example = RESEARCH_EXAMPLES.find((item) => item.key === key);
    if (!example) throw new NotFoundException('Research example not found');
    return example;
  }

  private async artifactRecord(
    id: string,
    example: ResearchExampleConfig = magneticExample,
  ): Promise<ArtifactEntity> {
    this.assertId(id);
    const record = await this.artifacts.findOne({
      where: {
        id,
        organization: { id: example.organizationId },
        visibility: RecordVisibility.PUBLIC,
        archivedAt: IsNull(),
      },
    });
    if (!record || !this.isCurated(record, example)) {
      throw new NotFoundException('Showcase artifact not found');
    }
    return record;
  }

  private async workflowRecord(
    id: string,
    example: ResearchExampleConfig = magneticExample,
  ): Promise<WorkflowEntity> {
    this.assertId(id);
    const record = await this.workflows.findOne({
      where: {
        id,
        organization: { id: example.organizationId },
        visibility: RecordVisibility.PUBLIC,
      },
      relations: { artifacts: true },
    });
    if (!record || !this.isCurated(record, example)) {
      throw new NotFoundException('Showcase workflow not found');
    }
    return record;
  }

  async list() {
    return this.catalogFor(magneticExample);
  }

  async examples() {
    return {
      examples: await Promise.all(
        RESEARCH_EXAMPLES.map((example) => this.catalogFor(example)),
      ),
    };
  }

  private async catalogFor(example: ResearchExampleConfig) {
    const [artifacts, workflows] = await Promise.all([
      this.artifacts.find({
        where: {
          organization: { id: example.organizationId },
          visibility: RecordVisibility.PUBLIC,
          archivedAt: IsNull(),
        },
        order: { title: 'ASC' },
      }),
      this.workflows.find({
        where: {
          organization: { id: example.organizationId },
          visibility: RecordVisibility.PUBLIC,
        },
        relations: { artifacts: true },
        order: { title: 'ASC' },
      }),
    ]);
    const curatedArtifacts = artifacts.filter((artifact) =>
      this.isCurated(artifact, example),
    );
    const confirmedIds = new Set(
      curatedArtifacts
        .filter((artifact) => this.isConfirmed(artifact))
        .map((artifact) => artifact.id),
    );
    const curatedWorkflows = workflows.filter((workflow) =>
      this.isCurated(workflow, example),
    );
    const confirmedWorkflow = curatedWorkflows.some(
      (workflow) =>
        this.isConfirmed(workflow) &&
        workflow.artifacts?.length === example.expectedArtifactCount &&
        workflow.artifacts.every((artifact) => confirmedIds.has(artifact.id)),
    );
    return {
      key: example.key,
      organization: example.organization,
      summary: example.summary,
      source: example.source,
      ready:
        confirmedIds.size === example.expectedArtifactCount &&
        confirmedWorkflow,
      artifacts: curatedArtifacts.map((artifact) =>
        this.artifactShape(artifact, example),
      ),
      workflows: curatedWorkflows.map((workflow) =>
        this.workflowShape(
          workflow,
          (workflow.artifacts || [])
            .map((artifact) => artifact.id)
            .filter((id) =>
              curatedArtifacts.some((artifact) => artifact.id === id),
            ),
          example,
        ),
      ),
    };
  }

  async artifact(id: string) {
    return {
      source: MAGNETIC_ARCH_SOURCE,
      ...this.artifactShape(await this.artifactRecord(id)),
    };
  }

  async exampleArtifact(key: string, id: string) {
    const example = this.exampleFor(key);
    return {
      source: example.source,
      ...this.artifactShape(await this.artifactRecord(id, example), example),
    };
  }

  async exampleWorkflow(key: string, id: string) {
    const example = this.exampleFor(key);
    const record = await this.workflowRecord(id, example);
    const linked = await Promise.all(
      (record.artifacts || []).map(async (artifact) => {
        try {
          return await this.artifactRecord(artifact.id, example);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
          return null;
        }
      }),
    );
    return {
      source: example.source,
      ...this.workflowShape(
        record,
        linked
          .filter((artifact) => artifact !== null)
          .map((artifact) => artifact.id),
        example,
      ),
    };
  }

  async workflow(id: string) {
    const record = await this.workflowRecord(id);
    const linked = await Promise.all(
      (record.artifacts || []).map(async (artifact) => {
        try {
          return await this.artifactRecord(artifact.id);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
          return null;
        }
      }),
    );
    return {
      source: MAGNETIC_ARCH_SOURCE,
      ...this.workflowShape(
        record,
        linked.filter((item) => item !== null).map((item) => item.id),
      ),
    };
  }

  async history(type: ShowcaseAssetType, id: string) {
    return this.historyFor(magneticExample, type, id);
  }

  async exampleHistory(key: string, type: ShowcaseAssetType, id: string) {
    return this.historyFor(this.exampleFor(key), type, id);
  }

  private async historyFor(
    example: ResearchExampleConfig,
    type: ShowcaseAssetType,
    id: string,
  ) {
    const record =
      type === 'artifact'
        ? await this.artifactRecord(id, example)
        : await this.workflowRecord(id, example);
    if (!this.isConfirmed(record)) {
      throw new ServiceUnavailableException(
        'Ledger confirmation is not available',
      );
    }
    const visibleArtifactIds =
      type === 'workflow'
        ? new Set(
            (
              await this.artifacts.find({
                where: {
                  organization: { id: example.organizationId },
                  visibility: RecordVisibility.PUBLIC,
                  archivedAt: IsNull(),
                },
              })
            )
              .filter((artifact) => this.isCurated(artifact, example))
              .map((artifact) => artifact.id.toLowerCase()),
          )
        : null;
    let result: any;
    try {
      result = await this.historyWorker.fetchHistory(
        {
          artifactId: id.toLowerCase(),
          assetType: type,
          organizationId: example.organizationId,
          offset: 0,
          limit: 100,
          order: 'desc',
          includeValue: true,
        },
        randomUUID(),
      );
    } catch {
      throw new BadGatewayException('Ledger history is unavailable');
    }
    const rawItems = Array.isArray(result?.items)
      ? result.items.slice(0, 100)
      : [];
    const items = rawItems.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const source = item as Record<string, any>;
      const txId = source.txId || source.transactionId;
      const timestamp = source.timestamp || source.committedAt;
      if (
        typeof txId !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(txId) ||
        typeof timestamp !== 'string' ||
        timestamp.length > 64 ||
        Number.isNaN(Date.parse(timestamp))
      )
        return [];
      const ledgerRecord = source.record || source.value;
      const payload = ledgerRecord?.payload;
      const revision = ledgerRecord?.revision;
      const snapshot =
        type === 'artifact'
          ? {
              ...(typeof payload?.footprint === 'string' &&
              /^[a-f0-9]{64}$/.test(payload.footprint)
                ? { footprint: payload.footprint }
                : {}),
              manifest: this.publicManifest(payload?.manifest, example),
            }
          : {
              artifactIds: Array.isArray(payload?.artifactIds)
                ? payload.artifactIds
                    .filter(
                      (value: unknown) =>
                        typeof value === 'string' &&
                        /^[a-f0-9-]{36}$/i.test(value) &&
                        visibleArtifactIds?.has(value.toLowerCase()),
                    )
                    .slice(0, example.expectedArtifactCount)
                : [],
            };
      return [
        {
          txId,
          timestamp,
          ...(Number.isInteger(revision) && revision > 0 ? { revision } : {}),
          snapshot,
        },
      ];
    });
    return { items, count: items.length, hasMore: Boolean(result?.hasMore) };
  }
}
