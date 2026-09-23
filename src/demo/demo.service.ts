import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { Between, DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { ArtifactService } from '../artifact/artifact.service';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { GhwService } from '../artifact/ghw.service';
import { OutboxEntity, OutboxStatus } from '../messaging/outbox.entity';
import { OrganizationEntity } from '../organization/organization.entity';
import { OrganizationStatus } from '../organization/membership-status.enum';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import { Role } from '../shared/enums/role.enums';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { WorkflowService } from '../workflow/workflow.service';
import {
  DEMO_DEFAULT_CLOSES_AT,
  DEMO_DEFAULT_OPENS_AT,
  DEMO_EVENT_ARTIFACT_LIMIT,
  DEMO_EVENT_SESSION_LIMIT,
  DEMO_EVENT_WORKFLOW_LIMIT,
  DEMO_FILE_EXTENSIONS,
  DEMO_RETENTION_DAYS,
  DEMO_RUNTIME_ID,
  DEMO_SESSION_ARTIFACT_LIMIT,
  DEMO_SESSION_EVENT_LIMIT,
  DEMO_SESSION_MINUTES,
  DEMO_SESSION_WORKFLOW_LIMIT,
} from './demo.constants';
import { CreateDemoArtifactDto } from './dto/create-demo-artifact.dto';
import { CreateDemoEventDto } from './dto/create-demo-event.dto';
import { CreateDemoFeedbackDto } from './dto/create-demo-feedback.dto';
import { CreateDemoWorkflowDto } from './dto/create-demo-workflow.dto';
import { UpdateDemoStatusDto } from './dto/update-demo-status.dto';
import {
  DemoContributionType,
  DemoEventName,
  DemoLifecycleState,
  DemoOrganizationSlug,
  DemoResearchContext,
} from './demo.enums';
import { DemoContributionEntity } from './entities/demo-contribution.entity';
import { DemoEventEntity } from './entities/demo-event.entity';
import { DemoFeedbackEntity } from './entities/demo-feedback.entity';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';
import { DemoSessionEntity } from './entities/demo-session.entity';
import {
  DemoPrincipal,
  DemoSessionResult,
  DemoTokenPayload,
} from './demo.types';

type ReservationOutcome = 'reserved' | 'session-limit' | 'global-limit';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
    private readonly artifactService: ArtifactService,
    private readonly workflowService: WorkflowService,
    private readonly ghwService: GhwService,
    @InjectRepository(DemoSessionEntity)
    private readonly sessions: Repository<DemoSessionEntity>,
    @InjectRepository(DemoRuntimeEntity)
    private readonly runtime: Repository<DemoRuntimeEntity>,
    @InjectRepository(DemoEventEntity)
    private readonly events: Repository<DemoEventEntity>,
    @InjectRepository(DemoFeedbackEntity)
    private readonly feedback: Repository<DemoFeedbackEntity>,
    @InjectRepository(DemoContributionEntity)
    private readonly contributions: Repository<DemoContributionEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    @InjectRepository(ArtifactEntity)
    private readonly artifacts: Repository<ArtifactEntity>,
    @InjectRepository(WorkflowEntity)
    private readonly workflows: Repository<WorkflowEntity>,
  ) {}

  get allowedOrigin(): string {
    return this.config.get<string>(
      'DEMO_ALLOWED_ORIGIN',
      'https://demo.osc-staging.org',
    );
  }

  private secret(name: string): string {
    const value = this.config.get<string>(name);
    if (value && value.length >= 32) return value;
    if (process.env.NODE_ENV === 'test')
      return `${name}-test-only-secret-32-characters`;
    throw new ServiceUnavailableException(`${name} is not securely configured`);
  }

  private plusDays(value: Date, days = DEMO_RETENTION_DAYS): Date {
    return new Date(value.getTime() + days * 86_400_000);
  }

  private sessionHash(sessionId: string): string {
    return createHmac('sha256', this.secret('DEMO_ANALYTICS_HMAC_SECRET'))
      .update(sessionId)
      .digest('hex');
  }

  private csrfHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private async ensureRuntime(): Promise<DemoRuntimeEntity> {
    const existing = await this.runtime.findOneBy({ id: DEMO_RUNTIME_ID });
    if (existing) return existing;

    const initial = this.runtime.create({
      id: DEMO_RUNTIME_ID,
      state: DemoLifecycleState.SCHEDULED,
      runId: null,
      reason: null,
      opensAt: new Date(DEMO_DEFAULT_OPENS_AT),
      closesAt: new Date(DEMO_DEFAULT_CLOSES_AT),
      artifactReservations: 0,
      workflowReservations: 0,
      sessionReservations: 0,
      updatedAt: new Date(),
    });
    try {
      return await this.runtime.save(initial);
    } catch {
      const raced = await this.runtime.findOneBy({ id: DEMO_RUNTIME_ID });
      if (!raced)
        throw new ServiceUnavailableException('Demo state unavailable');
      return raced;
    }
  }

  private effectiveState(runtime: DemoRuntimeEntity, now = new Date()) {
    if (
      runtime.state === DemoLifecycleState.CLOSED ||
      now.getTime() >= runtime.closesAt.getTime()
    ) {
      return DemoLifecycleState.CLOSED;
    }
    if (runtime.state === DemoLifecycleState.READ_ONLY) {
      return DemoLifecycleState.READ_ONLY;
    }
    if (runtime.state === DemoLifecycleState.PREPARING) {
      return DemoLifecycleState.PREPARING;
    }
    if (
      runtime.state === DemoLifecycleState.OPEN &&
      now.getTime() >= runtime.opensAt.getTime()
    ) {
      return DemoLifecycleState.OPEN;
    }
    return DemoLifecycleState.SCHEDULED;
  }

  async getStatus() {
    const runtime = await this.ensureRuntime();
    const state = this.effectiveState(runtime);
    const messages: Record<DemoLifecycleState, string> = {
      [DemoLifecycleState.SCHEDULED]:
        'The interactive demonstration has not opened yet.',
      [DemoLifecycleState.PREPARING]:
        'The demonstration environment is being prepared and checked.',
      [DemoLifecycleState.OPEN]: 'The interactive demonstration is open.',
      [DemoLifecycleState.READ_ONLY]:
        'New contributions are paused; public demonstration records remain available.',
      [DemoLifecycleState.CLOSED]:
        'The interactive demonstration is closed; the status page remains available.',
    };
    return {
      state,
      message: messages[state],
      opensAt: runtime.opensAt,
      closesAt: runtime.closesAt,
      interactionsAllowed: state === DemoLifecycleState.OPEN,
    };
  }

  private publicOrganizationSlugs(requested?: string): DemoOrganizationSlug[] {
    if (!requested) return Object.values(DemoOrganizationSlug);
    if (
      !Object.values(DemoOrganizationSlug).includes(
        requested as DemoOrganizationSlug,
      )
    ) {
      throw new BadRequestException(
        'The requested demonstration organization is not allowed',
      );
    }
    return [requested as DemoOrganizationSlug];
  }

  async listPublicArtifacts(requestedOrganization?: string) {
    const organizationSlugs = this.publicOrganizationSlugs(
      requestedOrganization,
    );
    const runtime = await this.publicReadWindow();
    const contributions = await this.currentContributions(
      DemoContributionType.ARTIFACT,
      runtime,
    );
    if (!contributions.length) return [];
    const byId = new Map(
      contributions.map((contribution) => [
        contribution.recordId,
        contribution,
      ]),
    );
    const artifacts = await this.artifacts.find({
      relations: { organization: true },
      where: {
        id: In([...byId.keys()]),
        visibility: RecordVisibility.PUBLIC,
        archivedAt: IsNull(),
        organization: { slug: In(organizationSlugs) },
      },
      order: { submittedAt: 'DESC' },
      take: DEMO_EVENT_ARTIFACT_LIMIT,
    });
    return artifacts
      .filter((artifact) =>
        this.isDemoRecord(artifact, byId.get(artifact.id), runtime, true),
      )
      .map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        description: artifact.description,
        organization: artifact.organization.name,
        organizationSlug: artifact.organization.slug,
        contributorAlias: artifact.submitterUsername,
        researchContext:
          artifact.keywords.find((keyword) => keyword !== 'usrse26-demo') ||
          null,
        verified: artifact.verified,
        submissionState: artifact.submissionState,
        submittedAt: artifact.submittedAt,
      }));
  }

  async listPublicWorkflows(requestedOrganization?: string) {
    const organizationSlugs = this.publicOrganizationSlugs(
      requestedOrganization,
    );
    const runtime = await this.publicReadWindow();
    const contributions = await this.currentContributions(
      DemoContributionType.WORKFLOW,
      runtime,
    );
    if (!contributions.length) return [];
    const byId = new Map(
      contributions.map((contribution) => [
        contribution.recordId,
        contribution,
      ]),
    );
    const workflows = await this.workflows.find({
      relations: { organization: true, artifacts: true },
      where: {
        id: In([...byId.keys()]),
        visibility: RecordVisibility.PUBLIC,
        organization: { slug: In(organizationSlugs) },
      },
      order: { submittedAt: 'DESC' },
      take: DEMO_EVENT_WORKFLOW_LIMIT,
    });
    return Promise.all(
      workflows
        .filter((workflow) =>
          this.isDemoRecord(workflow, byId.get(workflow.id), runtime, true),
        )
        .map(async (workflow) => {
          const detail = await this.publicShape({
            contribution: byId.get(workflow.id)!,
            record: workflow,
            organization: workflow.organization,
            runtime,
          });
          return {
            id: workflow.id,
            title: workflow.title,
            description: workflow.description,
            organization: workflow.organization.name,
            organizationSlug: workflow.organization.slug,
            contributorAlias: workflow.submitterUsername,
            researchContext:
              workflow.keywords.find((keyword) => keyword !== 'usrse26-demo') ||
              null,
            artifactIds: 'artifactIds' in detail ? detail.artifactIds : [],
            submissionState: workflow.submissionState,
            submittedAt: workflow.submittedAt,
          };
        }),
    );
  }

  private async publicReadWindow(): Promise<DemoRuntimeEntity> {
    const runtime = await this.ensureRuntime();
    const now = new Date();
    if (
      now < runtime.opensAt ||
      now >= runtime.closesAt ||
      ![DemoLifecycleState.OPEN, DemoLifecycleState.READ_ONLY].includes(
        this.effectiveState(runtime, now),
      )
    ) {
      throw new NotFoundException('Demonstration record is unavailable');
    }
    return runtime;
  }

  private async currentContributions(
    recordType: DemoContributionType,
    runtime: DemoRuntimeEntity,
  ) {
    const now = new Date();
    const contributions = await this.contributions.find({
      where: {
        recordType,
        acceptedAt: Between(runtime.opensAt, runtime.closesAt),
      },
    });
    return contributions.filter(
      (contribution) =>
        contribution.acceptedAt < runtime.closesAt &&
        contribution.retentionExpiresAt > now,
    );
  }

  private isDemoRecord(
    record: ArtifactEntity | WorkflowEntity | null,
    contribution: DemoContributionEntity | undefined,
    runtime: DemoRuntimeEntity,
    publicOnly: boolean,
  ): boolean {
    const organization = record?.organization as OrganizationEntity | undefined;
    return !!(
      contribution &&
      record &&
      organization &&
      contribution.acceptedAt >= runtime.opensAt &&
      contribution.acceptedAt < runtime.closesAt &&
      contribution.retentionExpiresAt > new Date() &&
      organization.id === contribution.organizationId &&
      record.keywords?.includes('usrse26-demo') &&
      /^guest-[a-f0-9]+@demo\.invalid$/.test(record.submitterEmail) &&
      Object.values(DemoOrganizationSlug).includes(
        organization.slug as DemoOrganizationSlug,
      ) &&
      organization.status === OrganizationStatus.ACTIVE &&
      organization.archivedAt === null &&
      (!publicOnly || record.visibility === RecordVisibility.PUBLIC) &&
      (!(record instanceof ArtifactEntity) || record.archivedAt === null)
    );
  }

  private async demoRecord(
    recordType: DemoContributionType,
    recordId: string,
    publicOnly: boolean,
    principal?: DemoPrincipal,
    currentRuntime?: DemoRuntimeEntity,
  ) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        recordId,
      )
    ) {
      throw new NotFoundException('Demonstration record is unavailable');
    }
    const runtime = currentRuntime || (await this.publicReadWindow());
    const contribution = await this.contributions.findOneBy({
      recordType,
      recordId,
    });
    if (
      !contribution ||
      (principal &&
        (contribution.sessionHash !== principal.sessionHash ||
          contribution.organizationId !== principal.organizationId))
    ) {
      throw new NotFoundException('Demonstration record is unavailable');
    }
    const record =
      recordType === DemoContributionType.ARTIFACT
        ? await this.artifacts.findOne({
            where: { id: recordId },
            relations: { organization: true },
          })
        : await this.workflows.findOne({
            where: { id: recordId },
            relations: { organization: true, artifacts: true },
          });
    if (!this.isDemoRecord(record, contribution, runtime, publicOnly)) {
      throw new NotFoundException('Demonstration record is unavailable');
    }
    return {
      contribution,
      record,
      organization: record.organization as OrganizationEntity,
      runtime,
    };
  }

  private async publicShape(
    data: Awaited<ReturnType<DemoService['demoRecord']>>,
  ) {
    const { contribution, record, organization, runtime } = data;
    const common = {
      id: record.id,
      title: record.title,
      description: record.description,
      organization: organization.name,
      organizationSlug: organization.slug,
      contributorAlias: record.submitterUsername,
      researchContext: contribution.researchContext,
      submissionState: record.submissionState,
      submittedAt: record.submittedAt,
      ...(record.submissionState === SubmissionState.SUCCESS &&
      record.blockchainTxId
        ? { blockchainTxId: record.blockchainTxId }
        : {}),
    };
    if (contribution.recordType === DemoContributionType.ARTIFACT) {
      return { ...common, verified: (record as ArtifactEntity).verified };
    }
    const linkedIds = (record as WorkflowEntity).artifacts.map(
      (artifact) => artifact.id,
    );
    if (!linkedIds.length) return { ...common, artifactIds: [] };
    const linkedContributions = await this.contributions.findBy({
      recordType: DemoContributionType.ARTIFACT,
      recordId: In(linkedIds),
      organizationId: organization.id,
    });
    const validIds = linkedContributions
      .filter(
        (linked) =>
          linked.acceptedAt >= runtime.opensAt &&
          linked.acceptedAt < runtime.closesAt &&
          linked.retentionExpiresAt > new Date(),
      )
      .map((linked) => linked.recordId);
    const publicArtifacts = validIds.length
      ? await this.artifacts.find({
          where: {
            id: In(validIds),
            organization: { id: organization.id },
            visibility: RecordVisibility.PUBLIC,
            archivedAt: IsNull(),
          },
        })
      : [];
    const allowedIds = new Set(
      publicArtifacts
        .filter(
          (artifact) =>
            artifact.keywords?.includes('usrse26-demo') &&
            /^guest-[a-f0-9]+@demo\.invalid$/.test(artifact.submitterEmail),
        )
        .map((artifact) => artifact.id),
    );
    return {
      ...common,
      artifactIds: linkedIds.filter((id) => allowedIds.has(id)),
    };
  }

  async publicDetail(recordType: DemoContributionType, recordId: string) {
    const runtime = await this.publicReadWindow();
    return this.publicShape(
      await this.demoRecord(recordType, recordId, true, undefined, runtime),
    );
  }

  async listMine(principal: DemoPrincipal, recordType: DemoContributionType) {
    const runtime = await this.publicReadWindow();
    const contributions = await this.contributions.find({
      where: {
        sessionHash: principal.sessionHash,
        organizationId: principal.organizationId,
        recordType,
      },
      order: { acceptedAt: 'DESC' },
    });
    const items = [];
    for (const contribution of contributions) {
      try {
        items.push(
          await this.publicShape(
            await this.demoRecord(
              recordType,
              contribution.recordId,
              false,
              principal,
              runtime,
            ),
          ),
        );
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return items;
  }

  async publicHistory(
    recordType: DemoContributionType,
    recordId: string,
    correlationId?: string,
  ) {
    const runtime = await this.publicReadWindow();
    const { record, organization } = await this.demoRecord(
      recordType,
      recordId,
      true,
      undefined,
      runtime,
    );
    if (record.submissionState !== SubmissionState.SUCCESS) {
      return { items: [], count: 0 };
    }
    const result = await this.ghwService.fetchHistory(
      {
        artifactId: recordId.toLowerCase(),
        assetType:
          recordType === DemoContributionType.ARTIFACT
            ? 'artifact'
            : 'workflow',
        organizationId: organization.id,
        offset: 0,
        limit: 100,
        order: 'desc',
        includeValue: false,
      },
      correlationId || randomUUID(),
    );
    const items = Array.isArray(result?.items)
      ? result.items.slice(0, 100)
      : [];
    return {
      items: items.map((item: any) => ({
        txId: item.txId,
        timestamp: item.timestamp,
        isDelete: item.isDelete,
      })),
      count: result?.count ?? result?.total ?? 0,
    };
  }

  async assertOpen(): Promise<DemoRuntimeEntity> {
    const runtime = await this.ensureRuntime();
    if (this.effectiveState(runtime) !== DemoLifecycleState.OPEN) {
      throw new ServiceUnavailableException(
        'The demonstration is not accepting contributions',
      );
    }
    return runtime;
  }

  async createSession(
    organizationSlug: DemoOrganizationSlug,
  ): Promise<DemoSessionResult> {
    const runtime = await this.assertOpen();
    const organization = await this.organizations.findOneBy({
      slug: organizationSlug,
    });
    if (!organization) {
      throw new ServiceUnavailableException(
        'The selected demonstration organization is unavailable',
      );
    }

    const sessionReservation = await this.runtime
      .createQueryBuilder()
      .update(DemoRuntimeEntity)
      .set({ sessionReservations: () => '"sessionReservations" + 1' })
      .where('"id" = :id', { id: DEMO_RUNTIME_ID })
      .andWhere('"state" = :state', { state: DemoLifecycleState.OPEN })
      .andWhere('"closesAt" > :now', { now: new Date() })
      .andWhere('"sessionReservations" < :limit', {
        limit: DEMO_EVENT_SESSION_LIMIT,
      })
      .execute();
    if (sessionReservation.affected !== 1) {
      await this.runtime.update(
        { id: DEMO_RUNTIME_ID, state: DemoLifecycleState.OPEN },
        {
          state: DemoLifecycleState.READ_ONLY,
          reason:
            'Anonymous browser session capacity reached or the write window closed',
          updatedAt: new Date(),
        },
      );
      throw new ServiceUnavailableException(
        'The demonstration is now read-only',
      );
    }

    const sessionId = randomUUID();
    const csrfToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(
      Math.min(
        now.getTime() + DEMO_SESSION_MINUTES * 60_000,
        runtime.closesAt.getTime(),
      ),
    );
    if (expiresAt <= now)
      throw new ServiceUnavailableException('The demonstration is closed');

    const entity = this.sessions.create({
      sessionHash: this.sessionHash(sessionId),
      organizationId: organization.id,
      organizationSlug,
      contributorAlias: `guest-${randomBytes(4).toString('hex')}`,
      csrfHash: this.csrfHash(csrfToken),
      artifactCount: 0,
      workflowCount: 0,
      feedbackSubmitted: false,
      createdAt: now,
      expiresAt,
      absoluteCloseAt: runtime.closesAt,
      retentionExpiresAt: this.plusDays(now),
    });
    try {
      await this.sessions.save(entity);
    } catch (error) {
      await this.runtime
        .createQueryBuilder()
        .update(DemoRuntimeEntity)
        .set({
          sessionReservations: () =>
            'CASE WHEN "sessionReservations" > 0 THEN "sessionReservations" - 1 ELSE 0 END',
        })
        .where('"id" = :id', { id: DEMO_RUNTIME_ID })
        .execute();
      throw error;
    }
    await this.recordInternalEvent(entity, DemoEventName.SESSION_STARTED);

    const payload: DemoTokenPayload = {
      sub: sessionId,
      organizationId: organization.id,
      organizationSlug,
      role: Role.DEMO_CONTRIBUTOR,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.secret('DEMO_JWT_SECRET'),
      audience: 'usrse26-demo',
      issuer: 'osc-api',
      expiresIn: Math.max(
        1,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      ),
    });

    return {
      token,
      csrfToken,
      expiresAt,
      organization: organizationSlug,
      contributorAlias: entity.contributorAlias,
    };
  }

  async authenticate(token: string): Promise<DemoPrincipal> {
    let payload: DemoTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<DemoTokenPayload>(token, {
        secret: this.secret('DEMO_JWT_SECRET'),
        audience: 'usrse26-demo',
        issuer: 'osc-api',
      });
    } catch {
      throw new UnauthorizedException(
        'Invalid or expired demonstration session',
      );
    }
    if (payload.role !== Role.DEMO_CONTRIBUTOR || !payload.sub) {
      throw new UnauthorizedException('Invalid demonstration capability');
    }
    const session = await this.sessions.findOneBy({
      sessionHash: this.sessionHash(payload.sub),
    });
    const now = new Date();
    if (
      !session ||
      session.expiresAt <= now ||
      session.absoluteCloseAt <= now
    ) {
      throw new UnauthorizedException(
        'Invalid or expired demonstration session',
      );
    }
    if (
      session.organizationId !== payload.organizationId ||
      session.organizationSlug !== payload.organizationSlug
    ) {
      throw new UnauthorizedException(
        'Demonstration organization binding is invalid',
      );
    }
    return {
      isDemo: true,
      tokenSubject: payload.sub,
      sessionId: session.id,
      sessionHash: session.sessionHash,
      organizationId: session.organizationId,
      organizationSlug: session.organizationSlug,
      contributorAlias: session.contributorAlias,
      roles: [Role.DEMO_CONTRIBUTOR],
      expiresAt: session.expiresAt,
    };
  }

  async verifyMutation(principal: DemoPrincipal, csrfToken: string) {
    const session = await this.sessions.findOneBy({ id: principal.sessionId });
    if (
      !session ||
      !csrfToken ||
      !this.safeEquals(session.csrfHash, this.csrfHash(csrfToken))
    ) {
      throw new ForbiddenException('Invalid demonstration CSRF token');
    }
  }

  async refreshSession(principal: DemoPrincipal): Promise<DemoSessionResult> {
    const runtime = await this.assertOpen();
    const session = await this.sessions.findOneBy({ id: principal.sessionId });
    if (!session)
      throw new UnauthorizedException('Demonstration session is unavailable');
    const now = new Date();
    const expiresAt = new Date(
      Math.min(
        now.getTime() + DEMO_SESSION_MINUTES * 60_000,
        session.absoluteCloseAt.getTime(),
        runtime.closesAt.getTime(),
      ),
    );
    if (expiresAt <= now)
      throw new UnauthorizedException(
        'Demonstration session cannot be renewed',
      );
    const csrfToken = randomBytes(32).toString('base64url');
    session.csrfHash = this.csrfHash(csrfToken);
    session.expiresAt = expiresAt;
    await this.sessions.save(session);
    const token = await this.jwt.signAsync(
      {
        sub: principal.tokenSubject,
        organizationId: session.organizationId,
        organizationSlug: session.organizationSlug,
        role: Role.DEMO_CONTRIBUTOR,
      } satisfies DemoTokenPayload,
      {
        secret: this.secret('DEMO_JWT_SECRET'),
        audience: 'usrse26-demo',
        issuer: 'osc-api',
        expiresIn: Math.max(
          1,
          Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
        ),
      },
    );
    return {
      token,
      csrfToken,
      expiresAt,
      organization: session.organizationSlug,
      contributorAlias: session.contributorAlias,
    };
  }

  private async reserve(
    principal: DemoPrincipal,
    type: DemoContributionType,
  ): Promise<ReservationOutcome> {
    const sessionColumn =
      type === DemoContributionType.ARTIFACT
        ? 'artifactCount'
        : 'workflowCount';
    const runtimeColumn =
      type === DemoContributionType.ARTIFACT
        ? 'artifactReservations'
        : 'workflowReservations';
    const sessionLimit =
      type === DemoContributionType.ARTIFACT
        ? DEMO_SESSION_ARTIFACT_LIMIT
        : DEMO_SESSION_WORKFLOW_LIMIT;
    const globalLimit =
      type === DemoContributionType.ARTIFACT
        ? DEMO_EVENT_ARTIFACT_LIMIT
        : DEMO_EVENT_WORKFLOW_LIMIT;

    return this.dataSource.transaction(async (manager) => {
      const sessionUpdate = await manager
        .createQueryBuilder()
        .update(DemoSessionEntity)
        .set({ [sessionColumn]: () => `"${sessionColumn}" + 1` })
        .where('"id" = :id', { id: principal.sessionId })
        .andWhere(`"${sessionColumn}" < :sessionLimit`, { sessionLimit })
        .andWhere('"expiresAt" > :now', { now: new Date() })
        .execute();
      if (sessionUpdate.affected !== 1) return 'session-limit';

      const runtimeUpdate = await manager
        .createQueryBuilder()
        .update(DemoRuntimeEntity)
        .set({ [runtimeColumn]: () => `"${runtimeColumn}" + 1` })
        .where('"id" = :id', { id: DEMO_RUNTIME_ID })
        .andWhere('"state" = :state', { state: DemoLifecycleState.OPEN })
        .andWhere('"closesAt" > :now', { now: new Date() })
        .andWhere(`"${runtimeColumn}" < :globalLimit`, { globalLimit })
        .execute();
      if (runtimeUpdate.affected === 1) return 'reserved';

      await manager
        .createQueryBuilder()
        .update(DemoSessionEntity)
        .set({
          [sessionColumn]: () =>
            `CASE WHEN "${sessionColumn}" > 0 THEN "${sessionColumn}" - 1 ELSE 0 END`,
        })
        .where('"id" = :id', { id: principal.sessionId })
        .execute();
      await manager.update(
        DemoRuntimeEntity,
        { id: DEMO_RUNTIME_ID, state: DemoLifecycleState.OPEN },
        {
          state: DemoLifecycleState.READ_ONLY,
          reason: `${type} event quota reached or the write window closed`,
          updatedAt: new Date(),
        },
      );
      return 'global-limit';
    });
  }

  private async release(principal: DemoPrincipal, type: DemoContributionType) {
    const sessionColumn =
      type === DemoContributionType.ARTIFACT
        ? 'artifactCount'
        : 'workflowCount';
    const runtimeColumn =
      type === DemoContributionType.ARTIFACT
        ? 'artifactReservations'
        : 'workflowReservations';
    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(DemoSessionEntity)
        .set({
          [sessionColumn]: () =>
            `CASE WHEN "${sessionColumn}" > 0 THEN "${sessionColumn}" - 1 ELSE 0 END`,
        })
        .where('"id" = :id', { id: principal.sessionId })
        .execute();
      await manager
        .createQueryBuilder()
        .update(DemoRuntimeEntity)
        .set({
          [runtimeColumn]: () =>
            `CASE WHEN "${runtimeColumn}" > 0 THEN "${runtimeColumn}" - 1 ELSE 0 END`,
        })
        .where('"id" = :id', { id: DEMO_RUNTIME_ID })
        .execute();
    });
  }

  private enforceReservation(outcome: ReservationOutcome) {
    if (outcome === 'session-limit') {
      throw new HttpException(
        'This demonstration session has reached its contribution limit',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome === 'global-limit') {
      throw new ServiceUnavailableException(
        'The demonstration is now read-only',
      );
    }
  }

  private submitter(principal: DemoPrincipal) {
    return {
      userId: principal.sessionId,
      username: principal.contributorAlias,
      email: `${principal.contributorAlias}@demo.invalid`,
      organizationId: principal.organizationId,
    };
  }

  private controlledDescription(context: DemoResearchContext, noun: string) {
    return `This public ${noun} was created during the bounded US-RSE 2026 interactive demonstration using the controlled ${context.toLowerCase().replace(/_/g, ' ')} context. It contains no uploaded file content, original filename, personal name, or attendee email address.`;
  }

  private persistArtifact(
    recordId: string,
    principal: DemoPrincipal,
    dto: CreateDemoArtifactDto,
    correlationId?: string,
  ) {
    const manifestName = `demo-artifact-${recordId}.${dto.extension}`;
    return this.artifactService.create(
      {
        title: `Demo artifact ${principal.contributorAlias} ${recordId.slice(0, 8)}`,
        description: this.controlledDescription(
          dto.researchContext,
          'artifact',
        ),
        visibility: RecordVisibility.PUBLIC,
        keywords: ['usrse26-demo', dto.researchContext.toLowerCase()],
        links: [],
        dois: [],
        fundingAgencies: [],
        acknowledgements:
          'Generated through the OSC US-RSE 2026 interactive demonstration.',
        manifest: [
          {
            hash: dto.fingerprint,
            filename: manifestName,
            algorithm: 'sha256',
          },
        ],
        footprint: dto.fingerprint,
        submission_comment:
          'Created through the bounded US-RSE 2026 interactive demonstration.',
      },
      this.submitter(principal),
      correlationId || dto.requestId,
      recordId,
    );
  }

  private persistWorkflow(
    recordId: string,
    principal: DemoPrincipal,
    dto: CreateDemoWorkflowDto,
    correlationId?: string,
  ) {
    return this.workflowService.create(
      {
        title: `Demo workflow ${principal.contributorAlias} ${recordId.slice(0, 8)}`,
        description: this.controlledDescription(
          dto.researchContext,
          'workflow',
        ),
        visibility: RecordVisibility.PUBLIC,
        keywords: ['usrse26-demo', dto.researchContext.toLowerCase()],
        githubRepositories: [],
        artifactIds: dto.artifactIds,
        submission_comment:
          'Created through the bounded US-RSE 2026 interactive demonstration.',
      },
      this.submitter(principal),
      correlationId || dto.requestId,
      recordId,
    );
  }

  async createArtifact(
    principal: DemoPrincipal,
    dto: CreateDemoArtifactDto,
    correlationId?: string,
  ) {
    if (!DEMO_FILE_EXTENSIONS.has(dto.extension)) {
      throw new BadRequestException(
        'The selected file extension is not allowed',
      );
    }
    const existing = await this.contributions.findOneBy({
      sessionHash: principal.sessionHash,
      requestId: dto.requestId,
    });
    if (existing) {
      if (existing.recordType !== DemoContributionType.ARTIFACT) {
        throw new ConflictException(
          'The request identifier was already used for another contribution type',
        );
      }
      if (
        existing.fingerprint !== dto.fingerprint ||
        existing.sizeBytes !== dto.sizeBytes ||
        existing.extension !== dto.extension ||
        existing.researchContext !== dto.researchContext
      ) {
        throw new ConflictException(
          'The request identifier was already used with a different artifact payload',
        );
      }
      if (!(await this.artifacts.existsBy({ id: existing.recordId }))) {
        await this.persistArtifact(
          existing.recordId,
          principal,
          dto,
          correlationId,
        );
        await this.recordInternalEvent(
          principal,
          DemoEventName.ARTIFACT_ACCEPTED,
          'artifact',
        );
      }
      return this.artifactResponse(existing.recordId, principal);
    }

    const outcome = await this.reserve(
      principal,
      DemoContributionType.ARTIFACT,
    );
    this.enforceReservation(outcome);
    const recordId = randomUUID();
    const now = new Date();
    const contribution = this.contributions.create({
      recordType: DemoContributionType.ARTIFACT,
      recordId,
      requestId: dto.requestId,
      sessionHash: principal.sessionHash,
      organizationId: principal.organizationId,
      sizeBytes: dto.sizeBytes,
      extension: dto.extension,
      fingerprint: dto.fingerprint,
      researchContext: dto.researchContext,
      artifactIds: null,
      acceptedAt: now,
      retentionExpiresAt: this.plusDays(now),
    });
    try {
      await this.contributions.save(contribution);
    } catch (error) {
      await this.release(principal, DemoContributionType.ARTIFACT);
      const raced = await this.contributions.findOneBy({
        sessionHash: principal.sessionHash,
        requestId: dto.requestId,
      });
      if (raced) {
        throw new ConflictException(
          'The contribution request is already being processed; retry with the same request identifier',
        );
      }
      throw error;
    }
    try {
      await this.persistArtifact(recordId, principal, dto, correlationId);
    } catch (error) {
      await this.contributions.delete({ id: contribution.id });
      await this.release(principal, DemoContributionType.ARTIFACT);
      throw error;
    }
    await this.recordInternalEvent(
      principal,
      DemoEventName.ARTIFACT_ACCEPTED,
      'artifact',
    );
    return this.artifactResponse(recordId, principal);
  }

  async createWorkflow(
    principal: DemoPrincipal,
    dto: CreateDemoWorkflowDto,
    correlationId?: string,
  ) {
    const existing = await this.contributions.findOneBy({
      sessionHash: principal.sessionHash,
      requestId: dto.requestId,
    });
    if (existing) {
      if (existing.recordType !== DemoContributionType.WORKFLOW) {
        throw new ConflictException(
          'The request identifier was already used for another contribution type',
        );
      }
      if (
        existing.researchContext !== dto.researchContext ||
        JSON.stringify(existing.artifactIds) !== JSON.stringify(dto.artifactIds)
      ) {
        throw new ConflictException(
          'The request identifier was already used with a different workflow payload',
        );
      }
    }

    const runtime = await this.ensureRuntime();
    for (const artifactId of dto.artifactIds) {
      let artifact: ArtifactEntity;
      try {
        const eligible = await this.demoRecord(
          DemoContributionType.ARTIFACT,
          artifactId,
          true,
          principal,
          runtime,
        );
        artifact = eligible.record as ArtifactEntity;
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        throw new ForbiddenException(
          'Workflows may link only eligible artifacts from this demonstration session',
        );
      }
      if (artifact.submissionState === SubmissionState.FAILED) {
        throw new ForbiddenException('Workflows may not link failed artifacts');
      }
    }

    if (existing) {
      if (!(await this.workflows.existsBy({ id: existing.recordId }))) {
        await this.persistWorkflow(
          existing.recordId,
          principal,
          dto,
          correlationId,
        );
        await this.recordInternalEvent(
          principal,
          DemoEventName.WORKFLOW_ACCEPTED,
          'workflow',
        );
      }
      return this.workflowResponse(existing.recordId, principal);
    }

    const outcome = await this.reserve(
      principal,
      DemoContributionType.WORKFLOW,
    );
    this.enforceReservation(outcome);
    const recordId = randomUUID();
    const now = new Date();
    const contribution = this.contributions.create({
      recordType: DemoContributionType.WORKFLOW,
      recordId,
      requestId: dto.requestId,
      sessionHash: principal.sessionHash,
      organizationId: principal.organizationId,
      sizeBytes: null,
      extension: null,
      fingerprint: null,
      researchContext: dto.researchContext,
      artifactIds: dto.artifactIds,
      acceptedAt: now,
      retentionExpiresAt: this.plusDays(now),
    });
    try {
      await this.contributions.save(contribution);
    } catch (error) {
      await this.release(principal, DemoContributionType.WORKFLOW);
      const raced = await this.contributions.findOneBy({
        sessionHash: principal.sessionHash,
        requestId: dto.requestId,
      });
      if (raced) {
        throw new ConflictException(
          'The contribution request is already being processed; retry with the same request identifier',
        );
      }
      throw error;
    }
    try {
      await this.persistWorkflow(recordId, principal, dto, correlationId);
    } catch (error) {
      await this.contributions.delete({ id: contribution.id });
      await this.release(principal, DemoContributionType.WORKFLOW);
      throw error;
    }
    await this.recordInternalEvent(
      principal,
      DemoEventName.WORKFLOW_ACCEPTED,
      'workflow',
    );
    return this.workflowResponse(recordId, principal);
  }

  async artifactResponse(recordId: string, principal: DemoPrincipal) {
    await this.assertDemoRecordSession(
      DemoContributionType.ARTIFACT,
      recordId,
      principal,
    );
    const artifact = await this.artifactService.findOne(
      recordId,
      principal.organizationId,
    );
    return {
      id: artifact.id,
      title: artifact.title,
      organization: artifact.organization?.name,
      contributorAlias: artifact.submitterUsername,
      fingerprint: artifact.footprint,
      manifestName: artifact.manifest[0]?.filename,
      verified: artifact.verified,
      submissionState: artifact.submissionState,
      blockchainTxId: artifact.blockchainTxId,
      submissionError: artifact.submissionError,
      submittedAt: artifact.submittedAt,
    };
  }

  async workflowResponse(recordId: string, principal: DemoPrincipal) {
    await this.assertDemoRecordSession(
      DemoContributionType.WORKFLOW,
      recordId,
      principal,
    );
    const workflow = await this.workflowService.findOne(
      recordId,
      principal.organizationId,
    );
    return {
      id: workflow.id,
      title: workflow.title,
      organization: workflow.organization?.name,
      contributorAlias: workflow.submitterUsername,
      artifactIds: workflow.artifacts.map((artifact) => artifact.id),
      submissionState: workflow.submissionState,
      blockchainTxId: workflow.blockchainTxId,
      submissionError: workflow.submissionError,
      submittedAt: workflow.submittedAt,
    };
  }

  async getArtifactHistory(
    principal: DemoPrincipal,
    recordId: string,
    correlationId?: string,
  ) {
    await this.assertDemoRecordSession(
      DemoContributionType.ARTIFACT,
      recordId,
      principal,
    );
    const result = await this.artifactService.getHistory(
      recordId,
      { limit: '100', order: 'desc', includeValue: 'true' },
      correlationId,
      principal.organizationId,
    );
    await this.recordInternalEvent(
      principal,
      DemoEventName.HISTORY_VIEWED,
      'artifact',
    );
    return result;
  }

  async getWorkflowHistory(
    principal: DemoPrincipal,
    recordId: string,
    correlationId?: string,
  ) {
    await this.assertDemoRecordSession(
      DemoContributionType.WORKFLOW,
      recordId,
      principal,
    );
    await this.workflowService.findOne(recordId, principal.organizationId);
    const result = await this.ghwService.fetchHistory(
      {
        artifactId: recordId.toLowerCase(),
        assetType: 'workflow',
        organizationId: principal.organizationId,
        offset: 0,
        limit: 100,
        order: 'desc',
        includeValue: true,
      },
      correlationId || randomUUID(),
    );
    await this.recordInternalEvent(
      principal,
      DemoEventName.HISTORY_VIEWED,
      'workflow',
    );
    return {
      ...result,
      nextOffset: result?.hasMore ? 100 : undefined,
    };
  }

  private async assertDemoRecordSession(
    recordType: DemoContributionType,
    recordId: string,
    principal: DemoPrincipal,
  ): Promise<void> {
    try {
      await this.demoRecord(recordType, recordId, false, principal);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      throw new ForbiddenException(
        'The demonstration record is not available to this session',
      );
    }
  }

  async recordBrowserEvent(principal: DemoPrincipal, dto: CreateDemoEventDto) {
    const count = await this.events.countBy({
      sessionHash: principal.sessionHash,
    });
    if (count >= DEMO_SESSION_EVENT_LIMIT) {
      throw new HttpException(
        'The session event limit has been reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.recordInternalEvent(principal, dto.eventName);
    return { accepted: true };
  }

  private async recordInternalEvent(
    principal:
      | Pick<DemoPrincipal, 'sessionHash' | 'organizationId'>
      | DemoSessionEntity,
    eventName: DemoEventName,
    resourceType: string | null = null,
  ) {
    const now = new Date();
    try {
      await this.events.save(
        this.events.create({
          sessionHash: principal.sessionHash,
          organizationId: principal.organizationId,
          eventName,
          resourceType,
          occurredAt: now,
          retentionExpiresAt: this.plusDays(now),
        }),
      );
    } catch (error) {
      this.logger.error(
        `Could not record privacy-safe demo event: ${String(error)}`,
      );
    }
  }

  private escapeComment(comment: string | undefined): string | null {
    if (!comment) return null;
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return comment.replace(/[&<>"']/g, (character) => map[character]);
  }

  async submitFeedback(principal: DemoPrincipal, dto: CreateDemoFeedbackDto) {
    const reserved = await this.sessions
      .createQueryBuilder()
      .update(DemoSessionEntity)
      .set({ feedbackSubmitted: true })
      .where('"id" = :id', { id: principal.sessionId })
      .andWhere('"feedbackSubmitted" = :submitted', { submitted: false })
      .execute();
    if (reserved.affected !== 1) {
      throw new ConflictException('Feedback may be submitted once per session');
    }
    const now = new Date();
    try {
      await this.feedback.save(
        this.feedback.create({
          sessionHash: principal.sessionHash,
          organizationId: principal.organizationId,
          easeRating: dto.easeRating,
          provenanceRating: dto.provenanceRating,
          usefulnessRating: dto.usefulnessRating,
          privateComment: this.escapeComment(dto.comment),
          submittedAt: now,
          retentionExpiresAt: this.plusDays(now),
        }),
      );
      return { accepted: true };
    } catch (error) {
      await this.sessions.update(principal.sessionId, {
        feedbackSubmitted: false,
      });
      throw error;
    }
  }

  async getCounters() {
    const [
      anonymousBrowserSessions,
      artifactContributions,
      workflowContributions,
      historyViews,
    ] = await Promise.all([
      this.sessions.count(),
      this.contributions.findBy({ recordType: DemoContributionType.ARTIFACT }),
      this.contributions.findBy({ recordType: DemoContributionType.WORKFLOW }),
      this.events.countBy({ eventName: DemoEventName.HISTORY_VIEWED }),
    ]);
    const artifactIds = artifactContributions.map((item) => item.recordId);
    const workflowIds = workflowContributions.map((item) => item.recordId);
    const [confirmedArtifacts, confirmedWorkflows] = await Promise.all([
      artifactIds.length
        ? this.artifacts.countBy({
            id: In(artifactIds),
            submissionState: SubmissionState.SUCCESS,
          })
        : 0,
      workflowIds.length
        ? this.workflows.countBy({
            id: In(workflowIds),
            submissionState: SubmissionState.SUCCESS,
          })
        : 0,
    ]);
    return {
      anonymousBrowserSessions,
      acceptedArtifacts: artifactContributions.length,
      confirmedArtifacts,
      acceptedWorkflows: workflowContributions.length,
      confirmedWorkflows,
      provenanceHistoryViews: historyViews,
    };
  }

  private latencySummary(values: number[]) {
    const sorted = values
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((left, right) => left - right);
    const percentile = (fraction: number) =>
      sorted.length
        ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
        : null;
    return {
      sampleSize: sorted.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
    };
  }

  async getOperationalMetrics() {
    const [counters, artifactContributions, workflowContributions, outbox] =
      await Promise.all([
        this.getCounters(),
        this.contributions.findBy({
          recordType: DemoContributionType.ARTIFACT,
        }),
        this.contributions.findBy({
          recordType: DemoContributionType.WORKFLOW,
        }),
        this.dataSource.getRepository(OutboxEntity).find({
          select: { status: true, createdAt: true },
          where: [
            { status: OutboxStatus.PENDING },
            { status: OutboxStatus.FAILED },
          ],
        }),
      ]);
    const artifactAcceptedAt = new Map(
      artifactContributions.map((item) => [
        item.recordId,
        item.acceptedAt.getTime(),
      ]),
    );
    const workflowAcceptedAt = new Map(
      workflowContributions.map((item) => [
        item.recordId,
        item.acceptedAt.getTime(),
      ]),
    );
    const [artifacts, workflows] = await Promise.all([
      artifactAcceptedAt.size
        ? this.artifacts.find({
            select: { id: true, submissionState: true, updatedAt: true },
            where: {
              id: In([...artifactAcceptedAt.keys()]),
              submissionState: SubmissionState.SUCCESS,
            },
          })
        : [],
      workflowAcceptedAt.size
        ? this.workflows.find({
            select: { id: true, submissionState: true, updatedAt: true },
            where: {
              id: In([...workflowAcceptedAt.keys()]),
              submissionState: SubmissionState.SUCCESS,
            },
          })
        : [],
    ]);
    const artifactLatency = artifacts.flatMap((item) => {
      const acceptedAt = artifactAcceptedAt.get(item.id);
      return acceptedAt !== undefined && item.updatedAt
        ? [item.updatedAt.getTime() - acceptedAt]
        : [];
    });
    const workflowLatency = workflows.flatMap((item) => {
      const acceptedAt = workflowAcceptedAt.get(item.id);
      return acceptedAt !== undefined && item.updatedAt
        ? [item.updatedAt.getTime() - acceptedAt]
        : [];
    });
    const pending = outbox.filter(
      (item) => item.status === OutboxStatus.PENDING,
    );
    const oldestPending = pending.reduce<Date | null>(
      (oldest, item) =>
        !oldest || item.createdAt < oldest ? item.createdAt : oldest,
      null,
    );
    return {
      observedAt: new Date(),
      counters,
      confirmationLatencyMs: {
        artifact: this.latencySummary(artifactLatency),
        workflow: this.latencySummary(workflowLatency),
      },
      queue: {
        pending: pending.length,
        failed: outbox.length - pending.length,
        oldestPendingAgeSeconds: oldestPending
          ? Math.max(
              0,
              Math.round((Date.now() - oldestPending.getTime()) / 1000),
            )
          : 0,
      },
    };
  }

  async updateStatus(dto: UpdateDemoStatusDto) {
    const runtime = await this.ensureRuntime();
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : runtime.opensAt;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : runtime.closesAt;
    if (
      closesAt <= opensAt ||
      closesAt.getTime() - opensAt.getTime() > 72 * 3_600_000
    ) {
      throw new BadRequestException(
        'The lifecycle window must be positive and no longer than 72 hours',
      );
    }
    runtime.state = dto.state;
    runtime.runId = dto.runId;
    runtime.reason = dto.reason || null;
    runtime.opensAt = opensAt;
    runtime.closesAt = closesAt;
    runtime.updatedAt = new Date();
    await this.runtime.save(runtime);
    return this.getStatus();
  }

  verifyControlKey(value: string | undefined) {
    const expected = this.secret('DEMO_CONTROL_API_KEY');
    if (!value || !this.safeEquals(value, expected)) {
      throw new UnauthorizedException(
        'Invalid demonstration control credential',
      );
    }
  }

  private ratingDistribution(values: number[]) {
    const distribution = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const value of values) {
      const key = String(value) as keyof typeof distribution;
      if (!Number.isInteger(value) || !(key in distribution)) {
        throw new ServiceUnavailableException(
          'Survey aggregate source contains an invalid rating',
        );
      }
      distribution[key] += 1;
    }
    return distribution;
  }

  async exportSanitized() {
    const [counters, ratings, status] = await Promise.all([
      this.getCounters(),
      this.feedback.find({
        select: {
          easeRating: true,
          provenanceRating: true,
          usefulnessRating: true,
        },
      }),
      this.getStatus(),
    ]);
    return {
      schemaVersion: 1,
      exportedAt: new Date(),
      status: {
        state: status.state,
        opensAt: status.opensAt,
        closesAt: status.closesAt,
      },
      counters,
      survey: {
        sampleSize: ratings.length,
        ratings: {
          ease: this.ratingDistribution(ratings.map((item) => item.easeRating)),
          provenance: this.ratingDistribution(
            ratings.map((item) => item.provenanceRating),
          ),
          usefulness: this.ratingDistribution(
            ratings.map((item) => item.usefulnessRating),
          ),
        },
      },
      caveat:
        'Self-selected convenience sample from a conference demonstration; not a measure of community acceptance.',
    };
  }

  async purgeExpired() {
    const now = new Date();
    const [events, feedback, contributions, sessions] = await Promise.all([
      this.events.delete({ retentionExpiresAt: LessThan(now) }),
      this.feedback.delete({ retentionExpiresAt: LessThan(now) }),
      this.contributions.delete({ retentionExpiresAt: LessThan(now) }),
      this.sessions.delete({ retentionExpiresAt: LessThan(now) }),
    ]);
    return {
      purged: {
        events: events.affected || 0,
        feedback: feedback.affected || 0,
        contributions: contributions.affected || 0,
        sessions: sessions.affected || 0,
      },
    };
  }
}
