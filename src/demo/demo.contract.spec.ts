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
import { createHash, randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource, In, Repository } from 'typeorm';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { ArtifactService } from '../artifact/artifact.service';
import { GhwService } from '../artifact/ghw.service';
import { OutboxEntity, OutboxStatus } from '../messaging/outbox.entity';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';
import { OrganizationStatus } from '../organization/membership-status.enum';
import { OrganizationEntity } from '../organization/organization.entity';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import {
  BusinessError,
  BusinessLogicException,
} from '../shared/errors/business-errors';
import { UserEntity } from '../user/user.entity';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { DemoController } from './demo.controller';
import { DEMO_EVENT_SESSION_LIMIT } from './demo.constants';
import { DemoService } from './demo.service';
import {
  DemoContributionType,
  DemoLifecycleState,
  DemoOrganizationSlug,
  DemoResearchContext,
} from './demo.enums';
import { DemoContributionEntity } from './entities/demo-contribution.entity';
import { DemoArtifactEditEntity } from './entities/demo-artifact-edit.entity';
import { DemoEventEntity } from './entities/demo-event.entity';
import { DemoFeedbackEntity } from './entities/demo-feedback.entity';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';
import { DemoSessionEntity } from './entities/demo-session.entity';
import { DemoAccountEntity } from './entities/demo-account.entity';
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
  let artifactUpdates: number;

  beforeEach(async () => {
    artifactCreates = 0;
    artifactUpdates = 0;
    const entities = [
      OrganizationEntity,
      OrganizationMembershipEntity,
      UserEntity,
      ArtifactEntity,
      WorkflowEntity,
      OutboxEntity,
      DemoSessionEntity,
      DemoAccountEntity,
      DemoRuntimeEntity,
      DemoEventEntity,
      DemoFeedbackEntity,
      DemoContributionEntity,
      DemoArtifactEditEntity,
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
              if (
                await artifacts.existsBy({
                  title: dto.title,
                  organization: { id: submitter.organizationId },
                })
              ) {
                throw new BusinessLogicException(
                  'An artifact with this title already exists in the organization',
                  BusinessError.PRECONDITION_FAILED,
                );
              }
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
            updateUser: async (
              id: string,
              dto: any,
              _email: string,
              _correlationId: string,
              organizationId: string,
            ) => {
              const artifact = await artifacts.findOne({
                where: { id },
                relations: { organization: true },
              });
              if (!artifact || artifact.organization.id !== organizationId) {
                throw new NotFoundException();
              }
              artifactUpdates += 1;
              Object.assign(artifact, dto);
              return artifacts.save(artifact);
            },
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
                  githubRepositories: dto.githubRepositories,
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
            updateUser: async (id: string, dto: any) => {
              const workflow = await workflows.findOneOrFail({
                where: { id },
                relations: { organization: true, artifacts: true },
              });
              workflow.keywords = dto.keywords;
              workflow.githubRepositories = dto.githubRepositories;
              workflow.submission_comment = dto.submission_comment;
              workflow.artifacts = await artifacts.findBy({
                id: In(dto.artifactIds),
              });
              return workflows.save(workflow);
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

  function accountRequest(
    path: 'register' | 'sign-in',
    username: string,
    pin = '472915',
    organization = DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/demo/account/${path}`)
      .set('Origin', ORIGIN)
      .send({ organization, username, pin });
  }

  function accountSession(response: request.Response): Guest {
    return {
      cookie: String(response.headers['set-cookie'][0]).split(';')[0],
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
      updateArtifact: (id: string, body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch(`/api/v1/demo/artifacts/${id}`)
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
    title: `Conference microscopy dataset ${randomUUID().slice(0, 8)}`,
    description:
      'A public demonstration dataset describing microscopy observations and reproducible image analysis.',
    submissionComment: 'Created for a public provenance demonstration.',
    keywords: ['microscopy', 'provenance'],
    links: [],
    dois: [],
    fundingAgencies: [],
    acknowledgements: 'Conference demonstration.',
  });

  async function confirmArtifact(id: string) {
    await dataSource.getRepository(ArtifactEntity).update(id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: `confirmed-${id}`,
    });
  }

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
    await confirmArtifact(first.body.id);
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
    expect(workflowHistory.body).toEqual({ items: [], count: 0 });
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
    await confirmArtifact(artifact.body.id);
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

  it('accepts other research output and explains failed ledger submission without leaking internals', async () => {
    const owner = await createGuest();
    const created = await mutate(owner)
      .artifact({
        ...artifactBody(),
        researchContext: DemoResearchContext.OTHER,
      })
      .expect(201);
    await dataSource.getRepository(ArtifactEntity).update(created.body.id, {
      submissionState: SubmissionState.FAILED,
      submissionError:
        'HTTP 502 from bridge-nsg: peer0.org1.example.com:7051 unavailable',
    });
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${created.body.id}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      researchContext: DemoResearchContext.OTHER,
      submissionState: SubmissionState.FAILED,
      failureReason:
        'The blockchain network was unavailable during submission. No ledger confirmation was recorded.',
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /bridge-nsg|peer0|7051|submissionError/,
    );
  });

  it('serves anonymous cross-org detail and metadata-only history while mine stays session-bound', async () => {
    const owner = await createGuest();
    const sameOrg = await createGuest();
    const otherOrg = await createGuest(DemoOrganizationSlug.CITIZEN_SCIENCE);
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
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
              'lastUpdatedAt',
              'verified',
              'keywords',
              'links',
              'dois',
              'fundingAgencies',
              'acknowledgements',
              'submissionComment',
              'blockchainTxId',
              'manifest',
              'footprint',
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
              'keywords',
              'submissionComment',
              'githubRepositories',
            ]
        ).sort(),
      );
      expect(Object.keys(detail.body).join(',')).not.toMatch(
        /fingerprint|email|session|submissionError/i,
      );
      if (type === 'artifacts') {
        expect(detail.body.manifest).toEqual(artifact.body.manifest);
        expect(detail.body.footprint).toBe(artifact.body.fingerprint);
        expect(JSON.stringify(detail.body)).not.toMatch(
          /guest-[a-f0-9]+@demo\.invalid|original-private-name/i,
        );
      }
      const pendingHistory = await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}/history`)
        .expect(200);
      expect(pendingHistory.body).toEqual(
        type === 'artifacts'
          ? { items: [{ txId: 'workflow-history-transaction' }], count: 1 }
          : { items: [], count: 0 },
      );
    }
    expect(ghwService.fetchHistory).toHaveBeenCalledTimes(1);

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
        ([query]) => query.includeValue === true && query.limit === 100,
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

  it('sanitizes current worker history aliases without returning raw records', async () => {
    const guest = await createGuest();
    const artifact = await mutate(guest).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const workflow = await mutate(guest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'confirmed-artifact',
    });
    await dataSource.getRepository(WorkflowEntity).update(workflow.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'confirmed-workflow',
    });
    (ghwService.fetchHistory as jest.Mock).mockResolvedValue({
      items: [
        {
          transactionId: 'worker-tx',
          committedAt: '2026-09-23T01:02:03Z',
          deleted: false,
          record: { submitterEmail: 'private@example.org' },
        },
        {
          txId: null,
          transactionId: 'fallback-tx',
          timestamp: null,
          committedAt: '2026-09-23T02:03:04Z',
          isDelete: null,
          deleted: true,
          record: { fingerprint: 'private' },
        },
        {
          transactionId: 42,
          committedAt: { invalid: true },
          deleted: 'false',
          record: { secret: 'private' },
        },
      ],
      count: 3,
    });
    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/demo/public/${type}/${id}/history`)
        .expect(200);
      expect(response.body).toEqual({
        items: [
          {
            txId: 'worker-tx',
            timestamp: '2026-09-23T01:02:03Z',
            isDelete: false,
          },
          {
            txId: 'fallback-tx',
            timestamp: '2026-09-23T02:03:04Z',
            isDelete: true,
          },
        ],
        count: 3,
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /record|fingerprint|email|private/i,
      );
    }
    expect(
      (ghwService.fetchHistory as jest.Mock).mock.calls.map(([query]) => ({
        assetType: query.assetType,
        includeValue: query.includeValue,
      })),
    ).toEqual([
      { assetType: 'artifact', includeValue: true },
      { assetType: 'workflow', includeValue: true },
    ]);
  });

  it('sanitizes owned workflow history while preserving owner access', async () => {
    const owner = await createGuest();
    const peer = await createGuest();
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const workflow = await mutate(owner)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    await dataSource.getRepository(WorkflowEntity).update(workflow.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'confirmed-workflow',
    });
    (ghwService.fetchHistory as jest.Mock).mockResolvedValue({
      items: [
        {
          transactionId: 'workflow-tx',
          committedAt: '2026-09-26T01:02:03Z',
          deleted: false,
          record: {
            revision: 1,
            sessionHash: 'private-session',
            submitterEmail: 'private@example.org',
            payload: {
              title: 'Public workflow',
              fingerprint: 'private-fingerprint',
              manifest: [{ filename: 'original-secret.csv' }],
            },
          },
        },
      ],
      count: 1,
      internalSecret: 'must-not-escape',
    });
    const path = `/api/v1/demo/workflows/${workflow.body.id}/history`;
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', peer.cookie)
      .expect(403);
    const owned = await request(app.getHttpServer())
      .get(path)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(owned.body).toEqual({
      items: [
        {
          txId: 'workflow-tx',
          timestamp: '2026-09-26T01:02:03Z',
          isDelete: false,
          revision: 1,
        },
      ],
      count: 1,
    });
    expect(JSON.stringify(owned.body)).not.toMatch(
      /record|session|email|filename|fingerprint|manifest|secret|payload/i,
    );
    const publicHistory = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/workflows/${workflow.body.id}/history`)
      .expect(200);
    expect(publicHistory.body).toEqual(owned.body);
  });

  it('keeps guarded detail and history exclusive to the contributing session', async () => {
    const owner = await createGuest();
    const peer = await createGuest();
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const workflow = await mutate(owner)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    const base = '/api/v1/demo';
    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      for (const suffix of ['', '/history']) {
        await request(app.getHttpServer())
          .get(`${base}/${type}/${id}${suffix}`)
          .expect(401);
        await request(app.getHttpServer())
          .get(`${base}/${type}/${id}${suffix}`)
          .set('Cookie', peer.cookie)
          .expect(403);
      }
      const owned = await request(app.getHttpServer())
        .get(`${base}/${type}/${id}`)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(owned.body).toMatchObject({
        id,
        submissionState:
          type === 'artifacts'
            ? SubmissionState.SUCCESS
            : SubmissionState.PENDING,
      });
      await request(app.getHttpServer())
        .get(`${base}/${type}/${id}/history`)
        .set('Cookie', owner.cookie)
        .expect(200);
    }
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.SUCCESS,
    });
    await dataSource.getRepository(WorkflowEntity).update(workflow.body.id, {
      submissionState: SubmissionState.SUCCESS,
    });
    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      expect(
        (
          await request(app.getHttpServer())
            .get(`${base}/${type}/${id}`)
            .set('Cookie', owner.cookie)
            .expect(200)
        ).body.submissionState,
      ).toBe(SubmissionState.SUCCESS);
      await request(app.getHttpServer())
        .get(`${base}/${type}/${id}`)
        .set('Cookie', peer.cookie)
        .expect(403);
    }
  });

  it('limits public lists and session reads to current-run demo contributions', async () => {
    const guest = await createGuest();
    const artifact = await mutate(guest).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const workflow = await mutate(guest)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
      })
      .expect(201);
    const artifacts = dataSource.getRepository(ArtifactEntity);
    const workflows = dataSource.getRepository(WorkflowEntity);
    const originalArtifact = await artifacts.findOneOrFail({
      where: { id: artifact.body.id },
      relations: { organization: true },
    });
    const originalWorkflow = await workflows.findOneOrFail({
      where: { id: workflow.body.id },
      relations: { organization: true, artifacts: true },
    });
    const productArtifact = await artifacts.save(
      artifacts.create({
        ...originalArtifact,
        id: randomUUID(),
        keywords: ['product'],
        submitterEmail: 'product@example.org',
      }),
    );
    const productWorkflow = await workflows.save(
      workflows.create({
        ...originalWorkflow,
        id: randomUUID(),
        title: 'Product workflow',
        keywords: ['product'],
        submitterEmail: 'product@example.org',
      }),
    );
    const contributions = dataSource.getRepository(DemoContributionEntity);
    for (const [originalId, productId] of [
      [artifact.body.id, productArtifact.id],
      [workflow.body.id, productWorkflow.id],
    ]) {
      const original = await contributions.findOneByOrFail({
        recordId: originalId,
      });
      await contributions.save(
        contributions.create({
          ...original,
          id: randomUUID(),
          recordId: productId,
          requestId: randomUUID(),
        }),
      );
    }
    const base = '/api/v1/demo';
    const listIds = async (type: string) =>
      (
        await request(app.getHttpServer()).get(`${base}/${type}`).expect(200)
      ).body.map((item: any) => item.id);
    expect(await listIds('artifacts')).toEqual([artifact.body.id]);
    expect(await listIds('workflows')).toEqual([workflow.body.id]);
    expect(await listIds('artifacts')).not.toContain(productArtifact.id);
    expect(await listIds('workflows')).not.toContain(productWorkflow.id);

    const workflowContribution = await contributions.findOneByOrFail({
      recordId: workflow.body.id,
    });
    const oldAcceptedAt = new Date(Date.now() - 120_000);
    await contributions.update(
      { recordId: artifact.body.id },
      { acceptedAt: oldAcceptedAt },
    );
    await contributions.update(
      { recordId: workflow.body.id },
      { acceptedAt: oldAcceptedAt },
    );
    await dataSource.getRepository(DemoRuntimeEntity).update('usrse26', {
      opensAt: new Date(Date.now() - 60_000),
    });
    expect(await listIds('artifacts')).toEqual([]);
    expect(await listIds('workflows')).toEqual([]);
    for (const [type, id] of [
      ['artifacts', artifact.body.id],
      ['workflows', workflow.body.id],
    ]) {
      await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`${base}/public/${type}/${id}/history`)
        .expect(404);
      expect(
        (
          await request(app.getHttpServer())
            .get(`${base}/mine/${type}`)
            .set('Cookie', guest.cookie)
            .expect(200)
        ).body,
      ).toEqual([]);
      await request(app.getHttpServer())
        .get(`${base}/${type}/${id}`)
        .set('Cookie', guest.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get(`${base}/${type}/${id}/history`)
        .set('Cookie', guest.cookie)
        .expect(403);
    }
    await contributions.update(
      { recordId: workflow.body.id },
      {
        acceptedAt: workflowContribution.acceptedAt,
      },
    );
    const workflowDetail = await request(app.getHttpServer())
      .get(`${base}/public/workflows/${workflow.body.id}`)
      .expect(200);
    expect(workflowDetail.body.artifactIds).toEqual([]);
  });

  it('links confirmed same-organization artifacts while denying other organizations and ineligible records', async () => {
    const owner = await createGuest();
    const peer = await createGuest();
    const otherOrganization = await createGuest(
      DemoOrganizationSlug.CITIZEN_SCIENCE,
    );
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    const body = {
      requestId: randomUUID(),
      artifactIds: [artifact.body.id],
      researchContext: 'REPRODUCIBLE_ANALYSIS',
    };
    await mutate(peer).workflow(body).expect(403);
    await mutate(owner).workflow(body).expect(403);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: null,
    });
    await mutate(owner).workflow(body).expect(403);
    await confirmArtifact(artifact.body.id);
    await mutate(owner).workflow(body).expect(201);
    await mutate(peer)
      .workflow({ ...body, requestId: randomUUID() })
      .expect(201);
    await mutate(otherOrganization)
      .workflow({ ...body, requestId: randomUUID() })
      .expect(403);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.FAILED,
    });
    await mutate(owner)
      .workflow({ ...body, requestId: randomUUID() })
      .expect(403);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.PENDING,
      archivedAt: new Date(),
    });
    await mutate(owner)
      .workflow({ ...body, requestId: randomUUID() })
      .expect(403);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      archivedAt: null,
    });
    await dataSource
      .getRepository(DemoContributionEntity)
      .update(
        { recordId: artifact.body.id },
        { acceptedAt: new Date(Date.now() - 120_000) },
      );
    await dataSource.getRepository(DemoRuntimeEntity).update('usrse26', {
      opensAt: new Date(Date.now() - 60_000),
    });
    await mutate(owner)
      .workflow({ ...body, requestId: randomUUID() })
      .expect(403);
  });

  it('persists authored workflow fields and rejects changed idempotency payloads', async () => {
    const owner = await createGuest();
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const body = {
      requestId: randomUUID(),
      artifactIds: [artifact.body.id],
      researchContext: 'REPRODUCIBLE_ANALYSIS',
      title: `Microscopy analysis workflow ${randomUUID().slice(0, 8)}`,
      description:
        'A reproducible microscopy workflow linking a confirmed dataset to its analysis steps and software.',
      submissionComment: 'Initial conference workflow submission.',
      keywords: ['microscopy', 'reproducibility'],
      githubRepositories: [
        {
          url: 'https://github.com/example/research-workflow',
          description: 'Reproducible analysis source.',
          gitHash: 'abcdef0123456789',
          contents: [{ filename: 'analysis.py', hash: 'a'.repeat(64) }],
        },
      ],
    };
    const created = await mutate(owner).workflow(body).expect(201);
    expect(created.body).toMatchObject({
      title: body.title,
      description: body.description,
    });
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/workflows/${created.body.id}`)
      .expect(200);
    expect(publicDetail.body).toMatchObject({
      title: body.title,
      description: body.description,
      keywords: body.keywords,
      githubRepositories: [{ url: body.githubRepositories[0].url }],
    });
    expect(JSON.stringify(publicDetail.body)).not.toContain('analysis.py');
    await mutate(owner).workflow(body).expect(201);
    await mutate(owner)
      .workflow({ ...body, title: 'Different workflow title' })
      .expect(409);
    await mutate(owner)
      .workflow({
        ...body,
        requestId: randomUUID(),
        githubRepositories: [
          { ...body.githubRepositories[0], url: 'https://evil.example/repo' },
        ],
      })
      .expect(400);
  });

  it('retries an accepted workflow after its linked artifact fails or is archived', async () => {
    const owner = await createGuest();
    const peer = await createGuest();
    const artifact = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
    const body = {
      requestId: randomUUID(),
      artifactIds: [artifact.body.id],
      researchContext: 'REPRODUCIBLE_ANALYSIS',
    };
    const first = await mutate(owner).workflow(body).expect(201);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.FAILED,
      archivedAt: new Date(),
    });

    const retry = await mutate(owner).workflow(body).expect(201);
    expect(retry.body.id).toBe(first.body.id);
    await mutate(owner)
      .workflow({
        ...body,
        researchContext: 'RESEARCH_DATASET',
      })
      .expect(409);
    await mutate(peer).workflow(body).expect(403);

    await dataSource.getRepository(WorkflowEntity).delete(first.body.id);
    await mutate(owner).workflow(body).expect(403);
    await dataSource.getRepository(ArtifactEntity).update(artifact.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'confirmed-recovery',
      archivedAt: null,
    });
    const recovered = await mutate(owner).workflow(body).expect(201);
    expect(recovered.body.id).toBe(first.body.id);
    expect(
      await dataSource.getRepository(DemoContributionEntity).countBy({
        recordId: first.body.id,
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/workflows/${first.body.id}`)
      .set('Cookie', peer.cookie)
      .expect(403);
  });

  it('fails closed for spoofed, private, non-demo, deleted, expired and stale public reads', async () => {
    const guest = await createGuest();
    const artifact = await mutate(guest).artifact(artifactBody()).expect(201);
    await confirmArtifact(artifact.body.id);
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

  it('accepts the bounded rich guest form and rejects raw filename and weak text', async () => {
    const guest = await createGuest();
    const body = artifactBody();
    const created = await mutate(guest).artifact(body).expect(201);
    expect(created.body).toMatchObject({
      title: body.title,
      description: body.description,
      submissionComment: body.submissionComment,
      keywords: body.keywords,
      acknowledgements: body.acknowledgements,
    });
    await mutate(guest)
      .artifact({ ...artifactBody(), originalFilename: 'secret.csv' })
      .expect(400);
    await mutate(guest)
      .artifact({ ...artifactBody(), title: '  ' })
      .expect(400);
    await mutate(guest)
      .artifact({ ...artifactBody(), description: 'short' })
      .expect(400);
    const stored = await dataSource
      .getRepository(ArtifactEntity)
      .findOneByOrFail({ id: created.body.id });
    expect(stored.manifest[0].filename).toMatch(/^demo-artifact-/);
    expect(JSON.stringify(stored)).not.toContain('secret.csv');
  });

  it('returns a controlled conflict when a failed artifact already owns the title', async () => {
    const guest = await createGuest();
    const body = artifactBody();
    const first = await mutate(guest).artifact(body).expect(201);
    await dataSource.getRepository(ArtifactEntity).update(first.body.id, {
      submissionState: SubmissionState.FAILED,
      submissionError: 'internal ledger failure details',
    });
    const duplicate = await mutate(guest)
      .artifact({ ...body, requestId: randomUUID() })
      .expect(409);
    expect(duplicate.body.message).toBe(
      'An artifact with this title already exists',
    );
    expect(JSON.stringify(duplicate.body)).not.toMatch(
      /ledger|internal|query|stack|error details/i,
    );
    expect(artifactCreates).toBe(1);
    expect(
      await dataSource.getRepository(DemoContributionEntity).countBy({
        recordType: DemoContributionType.ARTIFACT,
      }),
    ).toBe(1);
    await mutate(guest).artifact(artifactBody()).expect(201);
  });

  it('limits owned edits, binds retries, and waits for each ledger confirmation', async () => {
    const owner = await createGuest();
    const peer = await createGuest();
    const otherOrg = await createGuest(DemoOrganizationSlug.CITIZEN_SCIENCE);
    const created = await mutate(owner).artifact(artifactBody()).expect(201);
    const id = created.body.id;
    const artifacts = dataSource.getRepository(ArtifactEntity);
    await artifacts.update(id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'tx-create',
    });
    const first = {
      requestId: randomUUID(),
      submissionComment: 'This revision adds a reproducible keyword.',
      keywords: ['reproducible', 'microscopy'],
    };
    await mutate(peer).updateArtifact(id, first).expect(404);
    await mutate(otherOrg).updateArtifact(id, first).expect(404);
    await mutate(owner)
      .updateArtifact(id, { ...first, title: 'Forbidden title' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/demo/artifacts/${id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', owner.cookie)
      .send(first)
      .expect(403);
    const edited = await mutate(owner).updateArtifact(id, first).expect(200);
    expect(edited.body.keywords).toEqual(first.keywords);
    expect(artifactUpdates).toBe(1);
    await mutate(owner).updateArtifact(id, first).expect(200);
    expect(artifactUpdates).toBe(1);
    await mutate(owner)
      .updateArtifact(id, { ...first, keywords: ['changed'] })
      .expect(409);
    const second = {
      requestId: randomUUID(),
      submissionComment: 'This revision adds a second public keyword.',
      keywords: ['second'],
    };
    await mutate(owner).updateArtifact(id, second).expect(409);
    await artifacts.update(id, {
      blockchainTxId: 'tx-first',
      updatedAt: new Date(),
    });
    await mutate(owner).updateArtifact(id, second).expect(200);
    expect(artifactUpdates).toBe(2);
    await artifacts.update(id, {
      blockchainTxId: 'tx-second',
      updatedAt: new Date(),
    });
    await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment: 'A third revision must be rejected by quota.',
        keywords: ['third'],
      })
      .expect(429);
    await demoService.updateStatus({
      state: DemoLifecycleState.READ_ONLY,
      runId: 'contract-test',
    });
    await mutate(owner).updateArtifact(id, first).expect(503);
  });

  it('rejects normalized no-op edits without reserving a revision slot', async () => {
    const owner = await createGuest();
    const create = artifactBody();
    const created = await mutate(owner).artifact(create).expect(201);
    await confirmArtifact(created.body.id);
    const id = created.body.id;
    await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment:
          'A different comment does not make unchanged metadata an edit.',
        keywords: [' provenance ', 'microscopy'],
        links: [],
        acknowledgements: ' Conference demonstration. ',
      })
      .expect(400);
    await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment:
          'A matching replacement fingerprint must not consume a slot.',
        fingerprint: create.fingerprint,
        sizeBytes: create.sizeBytes,
        extension: create.extension,
      })
      .expect(400);
    expect(
      await dataSource.getRepository(DemoArtifactEditEntity).countBy({
        recordId: id,
      }),
    ).toBe(0);
    expect(artifactUpdates).toBe(0);
    await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment:
          'A genuinely new keyword creates the first revision.',
        keywords: ['microscopy', 'provenance', 'new-keyword'],
      })
      .expect(200);
    expect(
      await dataSource.getRepository(DemoArtifactEditEntity).countBy({
        recordId: id,
      }),
    ).toBe(1);
    expect(artifactUpdates).toBe(1);
  });

  it('returns only each ledger revision’s safe snapshot fields', async () => {
    const guest = await createGuest();
    const created = await mutate(guest).artifact(artifactBody()).expect(201);
    await dataSource.getRepository(ArtifactEntity).update(created.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'tx-confirmed',
    });
    (ghwService.fetchHistory as jest.Mock).mockResolvedValue({
      items: [
        {
          transactionId: 'tx-2',
          committedAt: '2026-09-26T02:00:00Z',
          deleted: false,
          record: {
            revision: 2,
            createdBy: 'secret-user',
            payload: {
              title: 'Version two',
              keywords: ['second'],
              submission_comment: 'Public second revision',
              manifest: [{ filename: 'original-private-name.csv' }],
              submitterEmail: 'secret@example.org',
            },
          },
        },
        {
          transactionId: 'tx-1',
          committedAt: '2026-09-26T01:00:00Z',
          deleted: false,
          record: {
            revision: 1,
            payload: { title: 'Version one', keywords: ['first'] },
          },
        },
      ],
      count: 2,
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${created.body.id}/history`)
      .expect(200);
    expect(response.body.items).toEqual([
      {
        txId: 'tx-2',
        timestamp: '2026-09-26T02:00:00Z',
        isDelete: false,
        revision: 2,
        snapshot: {
          submissionState: 'SUCCESS',
          title: 'Version two',
          keywords: ['second'],
          submissionComment: 'Public second revision',
        },
      },
      {
        txId: 'tx-1',
        timestamp: '2026-09-26T01:00:00Z',
        isDelete: false,
        revision: 1,
        snapshot: {
          submissionState: 'SUCCESS',
          title: 'Version one',
          keywords: ['first'],
        },
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /secret|filename|email|session|createdBy|manifest/i,
    );
    const owned = await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${created.body.id}/history`)
      .set('Cookie', guest.cookie)
      .expect(200);
    expect(owned.body).toEqual(response.body);
  });

  it('registers a PIN account, restores ownership after sign-in, and rejects other owners', async () => {
    await accountRequest('register', 'researcher', '123').expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/demo/account/register')
      .set('Origin', 'https://evil.example')
      .send({
        organization: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY,
        username: 'researcher',
        pin: '472915',
      })
      .expect(403);
    const registered = await accountRequest('register', 'Researcher').expect(
      201,
    );
    expect(registered.body.accountUsername).toBe('researcher');
    expect(registered.body.pin).toBeUndefined();
    const owner = accountSession(registered);
    const created = await mutate(owner).artifact(artifactBody()).expect(201);
    await confirmArtifact(created.body.id);
    await request(app.getHttpServer())
      .post('/api/v1/demo/account/sign-out')
      .set('Origin', ORIGIN)
      .set('Cookie', owner.cookie)
      .set('X-Demo-CSRF', owner.csrfToken)
      .expect(201);
    await mutate(owner).artifact(artifactBody()).expect(401);
    await accountRequest('sign-in', 'researcher', '0000').expect(401);
    const signedIn = await accountRequest('sign-in', 'researcher').expect(201);
    const returning = accountSession(signedIn);
    const mine = await request(app.getHttpServer())
      .get('/api/v1/demo/mine/artifacts')
      .set('Cookie', returning.cookie)
      .expect(200);
    expect(mine.body.map((item: { id: string }) => item.id)).toContain(
      created.body.id,
    );
    await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${created.body.id}`)
      .set('Cookie', returning.cookie)
      .expect(200);
    const stranger = accountSession(
      await accountRequest('register', 'different').expect(201),
    );
    await mutate(stranger)
      .updateArtifact(created.body.id, {
        requestId: randomUUID(),
        submissionComment: 'Attempt to modify another contributor record.',
        keywords: ['wrong'],
      })
      .expect(404);
    const account = await dataSource
      .getRepository(DemoAccountEntity)
      .findOneByOrFail({ username: 'researcher' });
    expect(account.artifactCount).toBe(1);
  });

  it('temporarily locks a PIN account after five bad attempts', async () => {
    await accountRequest('register', 'locked', '4831').expect(201);
    for (let index = 0; index < 5; index++) {
      await accountRequest('sign-in', 'locked', '0000').expect(401);
    }
    await accountRequest('sign-in', 'locked', '4831').expect(401);
    const account = await dataSource
      .getRepository(DemoAccountEntity)
      .findOneByOrFail({ username: 'locked' });
    expect(account.failedAttempts).toBe(5);
    expect(account.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not let the retired guest-session quota lock out contributor accounts', async () => {
    await dataSource.getRepository(DemoRuntimeEntity).update('usrse26', {
      sessionReservations: DEMO_EVENT_SESSION_LIMIT,
    });
    const registered = await accountRequest('register', 'quotaowner').expect(
      201,
    );
    expect(registered.body.accountUsername).toBe('quotaowner');
    await accountRequest('sign-in', 'quotaowner').expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/demo/session')
      .set('Origin', ORIGIN)
      .send({ organization: DemoOrganizationSlug.NEUROSCIENCE_GATEWAY })
      .expect(503);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/demo/status')).body
        .state,
    ).toBe('OPEN');
  });

  it('allows only the confirmed workflow owner to manage metadata after a new sign-in', async () => {
    const registered = accountSession(
      await accountRequest('register', 'workflowowner').expect(201),
    );
    const artifact = await mutate(registered)
      .artifact(artifactBody())
      .expect(201);
    await confirmArtifact(artifact.body.id);
    const workflow = await mutate(registered)
      .workflow({
        requestId: randomUUID(),
        artifactIds: [artifact.body.id],
        researchContext: 'REPRODUCIBLE_ANALYSIS',
        title: 'A reproducible owner workflow',
        description:
          'This workflow has enough detail for the public contract test to exercise management and ownership.',
        submissionComment: 'Initial workflow submission for owner test.',
        keywords: ['initial'],
        githubRepositories: [],
      })
      .expect(201);
    await dataSource.getRepository(WorkflowEntity).update(workflow.body.id, {
      submissionState: SubmissionState.SUCCESS,
      blockchainTxId: 'confirmed-workflow-owner',
    });
    const stranger = accountSession(
      await accountRequest('register', 'workflowpeer').expect(201),
    );
    const edit = {
      requestId: randomUUID(),
      artifactIds: [artifact.body.id],
      keywords: ['revised'],
      githubRepositories: [],
      submissionComment: 'Revised workflow metadata by its owner.',
    };
    await request(app.getHttpServer())
      .patch(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', stranger.cookie)
      .set('X-Demo-CSRF', stranger.csrfToken)
      .send(edit)
      .expect(404);
    const returning = accountSession(
      await accountRequest('sign-in', 'workflowowner').expect(201),
    );
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', returning.cookie)
      .set('X-Demo-CSRF', returning.csrfToken)
      .send(edit)
      .expect(200);
    expect(updated.body.keywords).toEqual(['revised']);
    expect(updated.body.submissionComment).toBe(edit.submissionComment);
    const persisted = await dataSource
      .getRepository(WorkflowEntity)
      .findOneOrFail({
        where: { id: workflow.body.id },
        relations: { artifacts: true },
      });
    await dataSource.getRepository(OutboxEntity).save({
      routingKey: 'workflow.update',
      aggregateId: workflow.body.id,
      messageId: edit.requestId,
      payload: {
        patch: {
          artifactIds: persisted.artifacts.map((item) => item.id),
          keywords: persisted.keywords,
          githubRepositories: persisted.githubRepositories,
          submission_comment: persisted.submission_comment,
        },
      },
      status: OutboxStatus.PUBLISHED,
      attempts: 0,
      availableAt: new Date(),
      publishedAt: new Date(),
      lastError: null,
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', returning.cookie)
      .set('X-Demo-CSRF', returning.csrfToken)
      .send(edit)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', returning.cookie)
      .set('X-Demo-CSRF', returning.csrfToken)
      .send({ ...edit, keywords: ['different'] })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/demo/workflows/${workflow.body.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', returning.cookie)
      .set('X-Demo-CSRF', returning.csrfToken)
      .send({ ...edit, requestId: randomUUID(), title: 'Forbidden title' })
      .expect(400);
  });

  it('records bounded folder hashes and publishes generated manifest data without opening guarded writes', async () => {
    const owner = await createGuest();
    const other = await createGuest();
    const files = [
      { hash: 'a'.repeat(64), sizeBytes: 17, extension: 'csv' },
      { hash: 'b'.repeat(64), sizeBytes: 23, extension: 'json' },
    ];
    const canonical = files
      .map(
        (file, index) =>
          `${index + 1}\t${file.extension}\t${file.hash}\t${file.sizeBytes}`,
      )
      .join('\n');
    const fingerprint = createHash('sha256').update(canonical).digest('hex');
    const body = {
      ...artifactBody(),
      fingerprint,
      sizeBytes: 40,
      extension: 'bundle',
      files,
    };
    await mutate(owner)
      .artifact({ ...body, sizeBytes: 41 })
      .expect(400);
    await mutate(owner)
      .artifact({ ...body, fingerprint: 'c'.repeat(64) })
      .expect(400);
    const created = await mutate(owner).artifact(body).expect(201);
    const id = created.body.id;
    expect(created.body.manifest).toEqual([
      {
        filename: `demo-artifact-${id}-0001.csv`,
        hash: files[0].hash,
        algorithm: 'sha256',
      },
      {
        filename: `demo-artifact-${id}-0002.json`,
        hash: files[1].hash,
        algorithm: 'sha256',
      },
    ]);
    await confirmArtifact(id);
    await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment:
          'The same folder must not create a new ledger revision.',
        fingerprint,
        sizeBytes: 40,
        extension: 'bundle',
        files,
      })
      .expect(400);
    (ghwService.fetchHistory as jest.Mock).mockResolvedValue({
      items: [
        {
          txId: 'folder-tx',
          timestamp: '2026-09-28T00:00:00Z',
          record: {
            revision: 1,
            payload: {
              title: body.title,
              manifest: created.body.manifest,
              footprint: fingerprint,
            },
          },
        },
      ],
      count: 1,
    });
    const publicHistory = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${id}/history`)
      .expect(200);
    expect(publicHistory.body.items[0].snapshot.manifest).toEqual(
      created.body.manifest,
    );
    expect(publicHistory.body.items[0].snapshot.footprint).toBe(fingerprint);
    expect(publicHistory.body.items[0].snapshot.submissionState).toBe(
      'SUCCESS',
    );
    expect(JSON.stringify(publicHistory.body)).not.toMatch(
      /guest-[a-f0-9]+@demo\.invalid|session|original-private-name/i,
    );
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${id}`)
      .expect(200);
    expect(publicDetail.body.manifest).toEqual(created.body.manifest);
    expect(publicDetail.body.footprint).toBe(fingerprint);
    await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${id}/history`)
      .set('Cookie', other.cookie)
      .expect(403);
    const ownerHistory = await request(app.getHttpServer())
      .get(`/api/v1/demo/artifacts/${id}/history`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(ownerHistory.body.items[0].snapshot.manifest).toEqual(
      created.body.manifest,
    );
    expect(ownerHistory.body.items[0].snapshot.footprint).toBe(fingerprint);
    expect(ownerHistory.body).toEqual(publicHistory.body);
    const replacementFiles = [{ ...files[0], hash: 'c'.repeat(64) }, files[1]];
    const replacementCanonical = replacementFiles
      .map(
        (file, index) =>
          `${index + 1}\t${file.extension}\t${file.hash}\t${file.sizeBytes}`,
      )
      .join('\n');
    const replacementFootprint = createHash('sha256')
      .update(replacementCanonical)
      .digest('hex');
    const replaced = await mutate(owner)
      .updateArtifact(id, {
        requestId: randomUUID(),
        submissionComment: 'A changed folder creates a new pending revision.',
        fingerprint: replacementFootprint,
        sizeBytes: 40,
        extension: 'bundle',
        files: replacementFiles,
      })
      .expect(200);
    expect(replaced.body.manifest[0].hash).toBe('c'.repeat(64));
    expect(replaced.body.fingerprint).toBe(replacementFootprint);
    const pendingDetail = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${id}`)
      .expect(200);
    expect(pendingDetail.body.manifest).toBeUndefined();
    expect(pendingDetail.body.footprint).toBeUndefined();
    expect(pendingDetail.body.blockchainTxId).toBe(`confirmed-${id}`);
  });

  it('accepts a 500-file, 50 MiB manifest and rejects either limit being exceeded', async () => {
    const owner = await createGuest();
    const files = Array.from({ length: 500 }, (_, index) => ({
      hash: createHash('sha256').update(String(index)).digest('hex'),
      sizeBytes: index < 400 ? 104858 : 104856,
      extension: 'txt',
    }));
    const fingerprintFor = (entries: typeof files) =>
      createHash('sha256')
        .update(
          entries
            .map(
              (file, index) =>
                `${index + 1}\t${file.extension}\t${file.hash}\t${file.sizeBytes}`,
            )
            .join('\n'),
        )
        .digest('hex');
    const body = {
      ...artifactBody(),
      fingerprint: fingerprintFor(files),
      sizeBytes: 50 * 1024 * 1024,
      extension: 'bundle',
      files,
    };
    await mutate(owner)
      .artifact({
        ...body,
        files: [...files, { ...files[0], sizeBytes: 1 }],
      })
      .expect(400);
    await mutate(owner)
      .artifact({ ...body, sizeBytes: body.sizeBytes + 1 })
      .expect(400);

    const created = await mutate(owner).artifact(body).expect(201);
    expect(created.body.manifest).toHaveLength(500);
    expect(created.body.manifest[499].filename).toBe(
      `demo-artifact-${created.body.id}-0500.txt`,
    );
    await confirmArtifact(created.body.id);
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/demo/public/artifacts/${created.body.id}`)
      .expect(200);
    expect(publicDetail.body.manifest).toHaveLength(500);

    const replacement = [
      { ...files[0], hash: 'a'.repeat(64) },
      ...files.slice(1),
    ];
    const revised = await mutate(owner)
      .updateArtifact(created.body.id, {
        requestId: randomUUID(),
        submissionComment: 'A replacement manifest at the new file limit.',
        fingerprint: fingerprintFor(replacement),
        sizeBytes: body.sizeBytes,
        extension: 'bundle',
        files: replacement,
      })
      .expect(200);
    expect(revised.body.manifest).toHaveLength(500);
  }, 30000);
});
