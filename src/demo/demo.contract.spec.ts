import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { ArtifactService } from '../artifact/artifact.service';
import { GhwService } from '../artifact/ghw.service';
import { OutboxEntity } from '../messaging/outbox.entity';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';
import { OrganizationStatus } from '../organization/membership-status.enum';
import { OrganizationEntity } from '../organization/organization.entity';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import { UserEntity } from '../user/user.entity';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoLifecycleState, DemoOrganizationSlug } from './demo.enums';
import { DemoContributionEntity } from './entities/demo-contribution.entity';
import { DemoEventEntity } from './entities/demo-event.entity';
import { DemoFeedbackEntity } from './entities/demo-feedback.entity';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';
import { DemoSessionEntity } from './entities/demo-session.entity';
import { DemoAuthGuard } from './guards/demo-auth.guard';
import { DemoControlGuard } from './guards/demo-control.guard';
import { DemoMutationGuard } from './guards/demo-mutation.guard';
import { DemoOriginGuard } from './guards/demo-origin.guard';

const ORIGIN = 'https://demo.osc-staging.org';
const CONTROL_KEY = 'control-key-32-characters-for-tests';

interface Guest {
  cookie: string;
  csrfToken: string;
  alias: string;
}

describe('US-RSE 2026 demonstration contract', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let demoService: DemoService;
  let ghwService: GhwService;
  let artifactCreates: number;

  beforeEach(async () => {
    artifactCreates = 0;
    const entities = [
      OrganizationEntity,
      OrganizationMembershipEntity,
      UserEntity,
      ArtifactEntity,
      WorkflowEntity,
      OutboxEntity,
      DemoSessionEntity,
      DemoRuntimeEntity,
      DemoEventEntity,
      DemoFeedbackEntity,
      DemoContributionEntity,
    ];
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({}),
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          dropSchema: true,
          entities,
          synchronize: true,
        }),
        TypeOrmModule.forFeature(entities),
      ],
      controllers: [DemoController],
      providers: [
        DemoService,
        DemoAuthGuard,
        DemoMutationGuard,
        DemoOriginGuard,
        DemoControlGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string, fallback?: unknown) =>
              ({
                DEMO_ALLOWED_ORIGIN: ORIGIN,
                DEMO_JWT_SECRET: 'jwt-secret-32-characters-for-tests-only',
                DEMO_ANALYTICS_HMAC_SECRET:
                  'analytics-secret-32-characters-tests',
                DEMO_CONTROL_API_KEY: CONTROL_KEY,
              })[name] ?? fallback,
          },
        },
        {
          provide: ArtifactService,
          inject: [
            getRepositoryToken(ArtifactEntity),
            getRepositoryToken(OrganizationEntity),
          ],
          useFactory: (
            artifacts: Repository<ArtifactEntity>,
            organizations: Repository<OrganizationEntity>,
          ) => ({
            create: async (
              dto: any,
              submitter: any,
              _correlationId: string,
              id: string,
            ) => {
              artifactCreates += 1;
              const organization = await organizations.findOneByOrFail({
                id: submitter.organizationId,
              });
              const entity = await artifacts.save(
                artifacts.create({
                  id,
                  ...dto,
                  organization,
                  submitterEmail: submitter.email,
                  submitterUsername: submitter.username,
                  submittedAt: new Date(),
                  updatedAt: null,
                  archivedAt: null,
                  verified: false,
                  lastTimeVerified: null,
                  submissionState: SubmissionState.PENDING,
                }),
              );
              return entity;
            },
            findOne: async (id: string) => {
              const artifact = await artifacts.findOne({
                where: { id },
                relations: { organization: true },
              });
              if (!artifact) throw new NotFoundException();
              return artifact;
            },
            getHistory: async (id: string) => ({
              artifactId: id,
              history: [{ transactionId: 'demo-transaction' }],
            }),
          }),
        },
        {
          provide: WorkflowService,
          inject: [
            getRepositoryToken(WorkflowEntity),
            getRepositoryToken(ArtifactEntity),
            getRepositoryToken(OrganizationEntity),
          ],
          useFactory: (
            workflows: Repository<WorkflowEntity>,
            artifacts: Repository<ArtifactEntity>,
            organizations: Repository<OrganizationEntity>,
          ) => ({
            create: async (
              dto: any,
              submitter: any,
              _correlationId: string,
              id: string,
            ) => {
              const organization = await organizations.findOneByOrFail({
                id: submitter.organizationId,
              });
              const linkedArtifacts = await artifacts.findBy({
                id: In(dto.artifactIds),
              });
              return workflows.save(
                workflows.create({
                  id,
                  title: dto.title,
                  description: dto.description,
                  visibility: dto.visibility,
                  keywords: dto.keywords,
                  githubRepositories: [],
                  artifacts: linkedArtifacts,
                  organization,
                  submitterEmail: submitter.email,
                  submitterUsername: submitter.username,
                  submission_comment: dto.submission_comment,
                  submittedAt: new Date(),
                  updatedAt: null,
                  submissionState: SubmissionState.PENDING,
                }),
              );
            },
            findOne: async (id: string) => {
              const workflow = await workflows.findOne({
                where: { id },
                relations: { organization: true, artifacts: true },
              });
              if (!workflow) throw new NotFoundException();
              return workflow;
            },
          }),
        },
        {
          provide: GhwService,
          useValue: {
            fetchHistory: jest.fn(async (query: any) => ({
              assetType: query.assetType,
              artifactId: query.artifactId,
              items: [{ txId: 'workflow-history-transaction' }],
              total: 1,
              hasMore: false,
            })),
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'api/v',
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = module.get(DataSource);
    demoService = module.get(DemoService);
    ghwService = module.get(GhwService);

    const organizations = dataSource.getRepository(OrganizationEntity);
    await organizations.save([
      organizations.create({
        name: 'Neuroscience Gateway',
        slug: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
        description: 'Public demonstration organization',
        status: OrganizationStatus.ACTIVE,
        archivedAt: null,
      }),
      organizations.create({
        name: 'Citizen Science',
        slug: DemoOrganizationSlug.CITIZEN_SCIENCE,
        description: 'Public demonstration organization',
        status: OrganizationStatus.ACTIVE,
        archivedAt: null,
      }),
    ]);
    await openDemo();
  });

  afterEach(async () => {
    await app.close();
  });

  async function openDemo() {
    const now = Date.now();
    await demoService.updateStatus({
      state: DemoLifecycleState.OPEN,
      runId: 'contract-test',
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3_600_000).toISOString(),
    });
  }

  async function createGuest(
    organization = DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
  ): Promise<Guest> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/demo/session')
      .set('Origin', ORIGIN)
      .send({ organization })
      .expect(201);
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie[0].split(';')[0];
    return {
      cookie,
      csrfToken: response.body.csrfToken,
      alias: response.body.contributorAlias,
    };
  }

  function mutate(guest: Guest) {
    return {
      artifact: (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post('/api/v1/demo/artifacts')
          .set('Origin', ORIGIN)
          .set('Cookie', guest.cookie)
          .set('X-Demo-CSRF', guest.csrfToken)
          .send(body),
      workflow: (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post('/api/v1/demo/workflows')
          .set('Origin', ORIGIN)
          .set('Cookie', guest.cookie)
          .set('X-Demo-CSRF', guest.csrfToken)
          .send(body),
    };
  }

  const artifactBody = () => ({
    requestId: randomUUID(),
    fingerprint: 'a'.repeat(64),
    sizeBytes: 1024,
    extension: 'csv',
    researchContext: 'RESEARCH_DATASET',
  });

  it('uses an exact-origin, cookie-only, CSRF-protected guest boundary', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/demo/session')
      .set('Origin', 'https://evil.example')
      .send({ organization: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/demo/session')
      .set('Origin', ORIGIN)
      .send({
        organization: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
        email: 'not-allowed@example.org',
      })
      .expect(400);

    const sessionResponse = await request(app.getHttpServer())
      .post('/api/v1/demo/session')
      .set('Origin', ORIGIN)
      .send({ organization: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY })
      .expect(201);
    expect(sessionResponse.body.token).toBeUndefined();
    const cookieHeader = String(sessionResponse.headers['set-cookie'][0]);
    expect(cookieHeader).toContain('__Host-osc_demo=');
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain('SameSite=Strict');

    const guest = await createGuest();
    await request(app.getHttpServer())
      .post('/api/v1/demo/artifacts')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .send(artifactBody())
      .expect(403);
    await mutate(guest)
      .artifact({ ...artifactBody(), originalFilename: 'private-name.csv' })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/demo/internal/status')
      .set('Cookie', guest.cookie)
      .send({ state: DemoLifecycleState.READ_ONLY, runId: 'forbidden' })
      .expect(401);
  });

  it('binds organizations server-side and enforces idempotency, quotas, telemetry, and feedback privacy', async () => {
    const guest = await createGuest();
    const body = artifactBody();
    const first = await mutate(guest).artifact(body).expect(201);
    const retry = await mutate(guest).artifact(body).expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(artifactCreates).toBe(1);
    await mutate(guest)
      .artifact({ ...body, sizeBytes: body.sizeBytes + 1 })
      .expect(409);

    // Simulate a crash after reserving the request ID but before the record is
    // durably observable. A same-payload retry resumes with the same record ID.
    await dataSource.getRepository(ArtifactEntity).delete(first.body.id);
    const resumed = await mutate(guest).artifact(body).expect(201);
    expect(resumed.body.id).toBe(first.body.id);
    expect(artifactCreates).toBe(2);
    expect(await dataSource.getRepository(DemoContributionEntity).count()).toBe(
      1,
    );
    expect(
      (
        await dataSource.getRepository(DemoSessionEntity).findOneByOrFail({
          contributorAlias: guest.alias,
        })
      ).artifactCount,
    ).toBe(1);

    const stored = await dataSource.getRepository(ArtifactEntity).findOne({
      where: { id: first.body.id },
      relations: { organization: true },
    });
    expect(stored?.organization.slug).toBe(
      DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
    );
    expect(stored?.submitterEmail).toMatch(/^guest-[a-f0-9]+@demo\.invalid$/);
    expect(stored?.manifest[0].filename).toMatch(
      /^demo-artifact-[a-f0-9-]+\.csv$/,
    );
    expect(JSON.stringify(stored)).not.toContain('private-name');
    expect(stored?.visibility).toBe(RecordVisibility.PUBLIC);

    const otherGuest = await createGuest(DemoOrganizationSlug.CITIZEN_SCIENCE);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${first.body.id}`)
      .set('Cookie', otherGuest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${first.body.id}/history`)
      .set('Cookie', otherGuest.cookie)
      .expect(403);
    await mutate(otherGuest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [first.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(403);
    const workflow = await mutate(guest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [first.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    expect(workflow.body.organization).toBe('Neuroscience Gateway');
    await request(app.getHttpServer())
      .get(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Cookie', otherGuest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/workflows/${workflow.body.id}/history`)
      .set('Cookie', otherGuest.cookie)
      .expect(403);

    const publicArtifacts = await request(app.getHttpServer())
      .get('/api/v1/demo/artifacts?organization=neuroscience-gateway')
      .expect(200);
    expect(publicArtifacts.body).toHaveLength(1);
    expect(publicArtifacts.body[0]).toMatchObject({
      id: first.body.id,
      organization: 'Neuroscience Gateway',
      organizationSlug: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
      contributorAlias: guest.alias,
      researchContext: 'research_dataset',
    });
    expect(publicArtifacts.body[0].submitterEmail).toBeUndefined();
    expect(publicArtifacts.body[0].manifest).toBeUndefined();

    const publicWorkflows = await request(app.getHttpServer())
      .get('/api/v1/demo/workflows')
      .expect(200);
    expect(publicWorkflows.body).toHaveLength(1);
    expect(publicWorkflows.body[0]).toMatchObject({
      id: workflow.body.id,
      organizationSlug: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
      artifactIds: [first.body.id],
    });
    expect(publicWorkflows.body[0].submitterEmail).toBeUndefined();
    const workflowHistory = await request(app.getHttpServer())
      .get(`/api/v1/demo/workflows/${workflow.body.id}/history`)
      .set('Cookie', guest.cookie)
      .expect(200);
    expect(workflowHistory.body).toMatchObject({
      assetType: 'workflow',
      artifactId: workflow.body.id,
      total: 1,
    });
    await request(app.getHttpServer())
      .get('/api/v1/demo/artifacts?organization=untrusted')
      .expect(400);

    await mutate(guest).artifact(artifactBody()).expect(201);
    await mutate(guest).artifact(artifactBody()).expect(201);
    await mutate(guest).artifact(artifactBody()).expect(429);

    await request(app.getHttpServer())
      .post('/api/v1/demo/events')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({ eventName: 'STATUS_VIEWED' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/demo/events')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({
        eventName: 'HISTORY_VIEWED',
        resourceType: 'workflow',
        resourceId: workflow.body.id,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/demo/events')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({ eventName: 'ARTIFACT_ACCEPTED' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/demo/feedback')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({
        easeRating: 5,
        provenanceRating: 4,
        usefulnessRating: 5,
        comment: '<script>alert("x")</script>',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/demo/feedback')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({ easeRating: 5, provenanceRating: 4, usefulnessRating: 5 })
      .expect(409);
    const feedback = await dataSource
      .getRepository(DemoFeedbackEntity)
      .findOneBy({
        sessionHash: (
          await dataSource.getRepository(DemoSessionEntity).findOneByOrFail({
            contributorAlias: guest.alias,
          })
        ).sessionHash,
      });
    expect(feedback?.privateComment).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(feedback?.privateComment).not.toContain('<script>');

    const counters = await request(app.getHttpServer())
      .get('/api/v1/demo/counters')
      .expect(200);
    expect(counters.body).toMatchObject({
      anonymousBrowserSessions: 2,
      acceptedArtifacts: 3,
      acceptedWorkflows: 1,
      provenanceHistoryViews: 1,
    });

    await request(app.getHttpServer())
      .get('/api/v1/demo/internal/metrics')
      .expect(401);
    const metrics = await request(app.getHttpServer())
      .get('/api/v1/demo/internal/metrics')
      .set('X-Demo-Control-Key', CONTROL_KEY)
      .expect(200);
    expect(metrics.body).toMatchObject({
      counters: {
        anonymousBrowserSessions: 2,
        acceptedArtifacts: 3,
        acceptedWorkflows: 1,
      },
      confirmationLatencyMs: {
        artifact: { sampleSize: 0, p50: null, p95: null },
        workflow: { sampleSize: 0, p50: null, p95: null },
      },
      queue: { pending: 0, failed: 0, oldestPendingAgeSeconds: 0 },
    });

    await request(app.getHttpServer())
      .get('/api/v1/demo/internal/export')
      .expect(401);
    const sanitizedExport = await request(app.getHttpServer())
      .get('/api/v1/demo/internal/export')
      .set('X-Demo-Control-Key', CONTROL_KEY)
      .expect(200);
    expect(Object.keys(sanitizedExport.body).sort()).toEqual(
      [
        'schemaVersion',
        'exportedAt',
        'status',
        'counters',
        'survey',
        'caveat',
      ].sort(),
    );
    expect(Object.keys(sanitizedExport.body.status).sort()).toEqual(
      ['state', 'opensAt', 'closesAt'].sort(),
    );
    expect(sanitizedExport.body.survey).toEqual({
      sampleSize: 1,
      ratings: {
        ease: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
        provenance: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 },
        usefulness: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
      },
    });
    const serializedExport = JSON.stringify(sanitizedExport.body);
    for (const forbidden of [
      'organizationId',
      'submittedAt',
      'privateComment',
      'sessionHash',
    ]) {
      expect(serializedExport).not.toContain(forbidden);
    }
  });

  it('does not retain record identifiers in analytics while preserving aggregate counters', async () => {
    const guest = await createGuest();
    const artifact = await mutate(guest).artifact(artifactBody()).expect(201);
    const workflow = await mutate(guest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${artifact.body.id}/history`)
      .set('Cookie', guest.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/workflows/${workflow.body.id}/history`)
      .set('Cookie', guest.cookie)
      .expect(200);

    const eventRows = (await dataSource.query(
      'SELECT * FROM "demo_event"',
    )) as Array<Record<string, unknown>>;
    expect(eventRows.length).toBeGreaterThan(0);
    for (const row of eventRows) {
      expect(row).not.toHaveProperty('resourceId');
    }
    const serializedRows = JSON.stringify(eventRows);
    expect(serializedRows).not.toContain(artifact.body.id);
    expect(serializedRows).not.toContain(workflow.body.id);

    const counters = await request(app.getHttpServer())
      .get('/api/v1/demo/counters')
      .expect(200);
    expect(counters.body).toMatchObject({
      anonymousBrowserSessions: 1,
      acceptedArtifacts: 1,
      acceptedWorkflows: 1,
      provenanceHistoryViews: 2,
    });
  });

  it('serves anonymous cross-org detail and metadata-only history while mine stays session-bound', async () => {
    const owner = await createGuest();
    const sameOrg = await createGuest();
    const otherOrg = await createGuest(DemoOrganizationSlug.CITIZEN_SCIENCE);
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    const workflow = await mutate(owner)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    const base = '/api/v1/demo';

    for (const guest of [sameOrg, otherOrg]) {
      await request(app.getHttpServer())
        .get(`${base}/mine/artifacts`)
        .set('Cookie', guest.cookie)
        .expect(200, []);
      await request(app.getHttpServer())
        .get(`${base}/mine/workflows`)
        .set('Cookie', guest.cookie)
        .expect(200, []);
    }
    await request(app.getHttpServer())
      .get(`${base}/mine/artifacts`)
      .expect(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/mine/artifacts`)
          .set('Cookie', owner.cookie)
          .expect(200)
      ).body.map((item: any) => item.id),
    ).toEqual([artifact.body.id]);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/mine/workflows`)
          .set('Cookie', owner.cookie)
          .expect(200)
      ).body[0].artifactIds,
    ).toEqual([artifact.body.id]);

    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      const detail = await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}`)
        .expect(200);
      expect(detail.body).toMatchObject({
        id,
        organizationSlug: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
      });
      expect(Object.keys(detail.body).sort()).toEqual(
        (type === 'artifacts'
          ? [
              'id',
              'title',
              'description',
              'organization',
              'organizationSlug',
              'contributorAlias',
              'researchContext',
              'submissionState',
              'submittedAt',
              'verified',
            ]
          : [
              'id',
              'title',
              'description',
              'organization',
              'organizationSlug',
              'contributorAlias',
              'researchContext',
              'submissionState',
              'submittedAt',
              'artifactIds',
            ]
        ).sort(),
      );
      expect(Object.keys(detail.body).join(',')).not.toMatch(
        /fingerprint|manifest|filename|email|session|footprint|submissionError/i,
      );
      expect(
        (
          await request(app.getHttpServer())
            .get(`${base}/public/${type}/${id}/history`)
            .expect(200)
        ).body,
      ).toEqual({ items: [], count: 0 });
    }
    expect(ghwService.fetchHistory).not.toHaveBeenCalled();

    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'artifact-confirmed',
    });
    await dataSource.getRepository(WorkflowEntity).update(workflow.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'workflow-confirmed',
    });
    (ghwService.fetchHistory as jest.Mock).mockResolvedValue({
      items: [
        {
          txId: 'tx-1',
          timestamp: '2026-09-23T00:00:00Z',
          isDelete: false,
          value: { submitterEmail: 'secret@example.org' },
          fingerprint: 'secret',
        },
      ],
      count: 1,
      hasMore: false,
      rawFabric: 'secret',
    });
    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      const detail = await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}`)
        .expect(200);
      expect(detail.body.blockchainTxId).toContain('confirmed');
      const history = await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}/history`)
        .expect(200);
      expect(history.body).toEqual({
        items: [
          {
            txId: 'tx-1',
            timestamp: '2026-09-23T00:00:00Z',
            isDelete: false,
          },
        ],
        count: 1,
      });
    }
    expect(
      (ghwService.fetchHistory as jest.Mock).mock.calls.every(
        ([query]) => query.includeValue === false && query.limit === 100,
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .get(`${base}/artifacts/${artifact.body.id}`)
      .set('Cookie', otherOrg.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/workflows/${workflow.body.id}/history`)
      .set('Cookie', otherOrg.cookie)
      .expect(403);
  });

  it('fails closed for spoofed, private, non-demo, deleted, expired and stale public reads', async () => {
    const guest = await createGuest();
    const artifact = await mutate(guest).artifact(artifactBody()).expect(201);
    const workflow = await mutate(guest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    const artifacts = dataSource.getRepository(ArtifactEntity);
    const workflows = dataSource.getRepository(WorkflowEntity);
    const contributions = dataSource.getRepository(DemoContributionEntity);
    const base = '/api/v1/demo/public';
    const detail = (type: string, id: string) =>
      request(app.getHttpServer()).get(`${base}/${type}/${id}`);
    const history = (type: string, id: string) =>
      request(app.getHttpServer()).get(`${base}/${type}/${id}/history`);

    const original = await artifacts.findOneOrFail({
      where: { id: artifact.body.id },
      relations: { organization: true },
    });
    const product = await artifacts.save(
      artifacts.create({
        ...original,
        id: randomUUID(),
        keywords: ['product'],
        submitterEmail: 'user@example.org',
      }),
    );
    await detail('artifacts', product.id).expect(404);
    await history('artifacts', product.id).expect(404);
    const contribution = await contributions.findOneByOrFail({
      recordId: artifact.body.id,
    });
    await contributions.save(
      contributions.create({
        ...contribution,
        id: randomUUID(),
        recordId: product.id,
        requestId: randomUUID(),
      }),
    );
    await detail('artifacts', product.id).expect(404);
    await history('artifacts', product.id).expect(404);

    const storedWorkflow = await workflows.findOneOrFail({
      where: { id: workflow.body.id },
      relations: { artifacts: true },
    });
    storedWorkflow.artifacts.push(product);
    await workflows.save(storedWorkflow);
    expect(
      (await detail('workflows', workflow.body.id).expect(200)).body
        .artifactIds,
    ).toEqual([artifact.body.id]);

    const otherOrganization = await dataSource
      .getRepository(OrganizationEntity)
      .findOneByOrFail({ slug: DemoOrganizationSlug.CITIZEN_SCIENCE });
    await contributions.update(
      { recordId: artifact.body.id },
      {
        organizationId: otherOrganization.id,
      },
    );
    await detail('artifacts', artifact.body.id).expect(404);
    await history('artifacts', artifact.body.id).expect(404);
    await contributions.update(
      { recordId: artifact.body.id },
      {
        organizationId: contribution.organizationId,
      },
    );

    await artifacts.update(artifact.body.id, {
      visibility: RecordVisibility.PRIVATE,
    });
    await detail('artifacts', artifact.body.id).expect(404);
    await history('artifacts', artifact.body.id).expect(404);
    await artifacts.update(artifact.body.id, {
      visibility: RecordVisibility.PUBLIC,
      archivedAt: new Date(),
    });
    await detail('artifacts', artifact.body.id).expect(404);
    await artifacts.update(artifact.body.id, { archivedAt: null });
    await workflows.update(workflow.body.id, {
      visibility: RecordVisibility.PRIVATE,
    });
    await detail('workflows', workflow.body.id).expect(404);
    await history('workflows', workflow.body.id).expect(404);
    await workflows.update(workflow.body.id, {
      visibility: RecordVisibility.PUBLIC,
    });
    await contributions.update(
      { recordId: workflow.body.id },
      {
        retentionExpiresAt: new Date(Date.now() - 1000),
      },
    );
    await detail('workflows', workflow.body.id).expect(404);
    await history('workflows', workflow.body.id).expect(404);
    await contributions.update(
      { recordId: workflow.body.id },
      {
        retentionExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    await workflows.delete(workflow.body.id);
    await detail('workflows', workflow.body.id).expect(404);
    await history('workflows', workflow.body.id).expect(404);
    await dataSource.getRepository(DemoRuntimeEntity).update('usrse26', {
      closesAt: new Date(Date.now() - 1000),
    });
    await detail('artifacts', artifact.body.id).expect(404);
    await history('artifacts', artifact.body.id).expect(404);
  });

  it('fails closed to READ_ONLY at the global limit while preserving reads and privacy-safe events', async () => {
    const guest = await createGuest();
    await dataSource.getRepository(DemoRuntimeEntity).update('usrse26', {
      artifactReservations: 1000,
    });
    await mutate(guest).artifact(artifactBody()).expect(503);

    const status = await request(app.getHttpServer())
      .get('/api/v1/demo/status')
      .expect(200);
    expect(status.body.state).toBe(DemoLifecycleState.READ_ONLY);
    await mutate(guest).artifact(artifactBody()).expect(503);
    await request(app.getHttpServer())
      .post('/api/v1/demo/session/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .expect(503);
    await request(app.getHttpServer())
      .post('/api/v1/demo/events')
      .set('Origin', ORIGIN)
      .set('Cookie', guest.cookie)
      .set('X-Demo-CSRF', guest.csrfToken)
      .send({ eventName: 'SURVEY_SHOWN' })
      .expect(201);
    await request(app.getHttpServer()).get('/api/v1/demo/counters').expect(200);
  });
});
