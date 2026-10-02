import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { DataSource, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { DEMO_RETENTION_DAYS, DEMO_RUNTIME_ID } from './demo.constants';
import { CreateDemoUxEventDto } from './dto/create-demo-ux-event.dto';
import { CreateDemoUxFeedbackDto } from './dto/create-demo-ux-feedback.dto';
import { DemoUxBrowserEntity } from './entities/demo-ux-browser.entity';
import { DemoUxCounterEntity } from './entities/demo-ux-counter.entity';
import { DemoUxEventEntity } from './entities/demo-ux-event.entity';
import { DemoUxFeedbackEntity } from './entities/demo-ux-feedback.entity';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';

const UX_COOKIE = '__Host-osc_ux';
const UX_COOKIE_MS = DEMO_RETENTION_DAYS * 86_400_000;
const UX_VISIT_IDLE_MS = 30 * 60_000;
const UX_MAX_EVENTS_PER_BROWSER = 1_000;
const UX_REPORT_EVENT_LIMIT = 100_000;

type Phase = 'REHEARSAL' | 'LIVE';
type CounterName =
  | 'CONSENT_ACCEPTED'
  | 'CONSENT_REJECTED'
  | 'CONSENT_REVOKED'
  | 'SURVEY_OPENED'
  | 'SURVEY_SUBMITTED';

@Injectable()
export class DemoUxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoUxService.name);
  private lastPurgeAt = 0;
  private surveyWindow = { startedAt: 0, count: 0 };
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(DemoUxBrowserEntity)
    private readonly browsers: Repository<DemoUxBrowserEntity>,
    @InjectRepository(DemoUxEventEntity)
    private readonly events: Repository<DemoUxEventEntity>,
    @InjectRepository(DemoUxCounterEntity)
    private readonly counters: Repository<DemoUxCounterEntity>,
    @InjectRepository(DemoUxFeedbackEntity)
    private readonly feedback: Repository<DemoUxFeedbackEntity>,
    @InjectRepository(DemoRuntimeEntity)
    private readonly runtime: Repository<DemoRuntimeEntity>,
  ) {}

  onModuleInit() {
    void this.purgeExpired().catch((error) =>
      this.logger.error(`UX retention cleanup failed: ${String(error)}`),
    );
    this.purgeTimer = setInterval(() => {
      void this.purgeExpired().catch((error) =>
        this.logger.error(`UX retention cleanup failed: ${String(error)}`),
      );
    }, 3_600_000);
    this.purgeTimer.unref();
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  private phase(): Phase {
    return this.config.get<string>('DEMO_UX_RUN_PHASE') === 'LIVE'
      ? 'LIVE'
      : 'REHEARSAL';
  }

  private async runContext() {
    const runtime = await this.runtime.findOneBy({ id: DEMO_RUNTIME_ID });
    return { phase: this.phase(), runId: runtime?.runId || null };
  }

  private expiresAt(now: Date) {
    return new Date(now.getTime() + UX_COOKIE_MS);
  }

  private browserHash(token: string) {
    const secret = this.config.get<string>('DEMO_ANALYTICS_HMAC_SECRET');
    if (!secret || secret.length < 32) {
      throw new HttpException(
        'Analytics is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  private cookieToken(request: Request) {
    const cookie = request.headers.cookie || '';
    const value = cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${UX_COOKIE}=`))
      ?.slice(UX_COOKIE.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }

  private async browser(request: Request) {
    const token = this.cookieToken(request);
    if (!token) return null;
    return this.browsers.findOneBy({
      browserHash: this.browserHash(token),
      expiresAt: MoreThan(new Date()),
    });
  }

  private async count(eventType: CounterName) {
    const now = new Date();
    const context = await this.runContext();
    await this.counters.save(
      this.counters.create({
        eventType,
        ...context,
        occurredAt: now,
        retentionExpiresAt: this.expiresAt(now),
      }),
    );
  }

  private async maybePurge() {
    if (Date.now() - this.lastPurgeAt < 3_600_000) return;
    this.lastPurgeAt = Date.now();
    await this.purgeExpired();
  }

  async consent(request: Request, response: Response) {
    await this.maybePurge();
    const existing = await this.browser(request);
    if (existing) {
      return { consented: true, expiresAt: existing.expiresAt };
    }
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = this.expiresAt(now);
    await this.browsers.save(
      this.browsers.create({
        browserHash: this.browserHash(token),
        consentedAt: now,
        expiresAt,
      }),
    );
    response.cookie(UX_COOKIE, token, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: UX_COOKIE_MS,
    });
    await this.count('CONSENT_ACCEPTED');
    return { consented: true, expiresAt };
  }

  async reject() {
    await this.maybePurge();
    await this.count('CONSENT_REJECTED');
    return { consented: false };
  }

  async recordEvent(request: Request, dto: CreateDemoUxEventDto) {
    const browser = await this.browser(request);
    if (!browser) throw new ForbiddenException('Analytics consent is required');
    const used = await this.events.countBy({
      browserHash: browser.browserHash,
    });
    if (used >= UX_MAX_EVENTS_PER_BROWSER) {
      throw new HttpException(
        'Analytics event limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const now = new Date();
    await this.events.save(
      this.events.create({
        browserHash: browser.browserHash,
        eventType: dto.eventType,
        route: dto.route,
        deviceCategory: dto.deviceCategory,
        ...(await this.runContext()),
        occurredAt: now,
        retentionExpiresAt: this.expiresAt(now),
      }),
    );
    return { accepted: true };
  }

  async revoke(request: Request, response: Response) {
    const token = this.cookieToken(request);
    if (token) {
      const browserHash = this.browserHash(token);
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(DemoUxEventEntity, { browserHash });
        await manager.delete(DemoUxBrowserEntity, { browserHash });
      });
    }
    response.clearCookie(UX_COOKIE, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    await this.count('CONSENT_REVOKED');
    return { consented: false, deleted: true };
  }

  private reserveSurveyWrite() {
    const now = Date.now();
    if (now - this.surveyWindow.startedAt > 60_000) {
      this.surveyWindow = { startedAt: now, count: 0 };
    }
    this.surveyWindow.count += 1;
    if (this.surveyWindow.count > 120) {
      throw new HttpException(
        'Please try again shortly',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async surveyOpen() {
    this.reserveSurveyWrite();
    await this.maybePurge();
    await this.count('SURVEY_OPENED');
    return { accepted: true };
  }

  async submitSurvey(dto: CreateDemoUxFeedbackDto) {
    this.reserveSurveyWrite();
    await this.maybePurge();
    const comment = dto.overallComment?.trim() || null;
    if (dto.visualRating == null && !dto.automationInterest && !comment) {
      throw new BadRequestException(
        'Answer at least one question or skip the survey',
      );
    }
    const now = new Date();
    await this.feedback.save(
      this.feedback.create({
        visualRating: dto.visualRating ?? null,
        automationInterest: dto.automationInterest || null,
        overallComment: comment,
        ...(await this.runContext()),
        submittedAt: now,
        retentionExpiresAt: this.expiresAt(now),
      }),
    );
    await this.count('SURVEY_SUBMITTED');
    return { accepted: true };
  }

  async comments() {
    await this.maybePurge();
    const rows = await this.feedback.find({
      where: { retentionExpiresAt: MoreThan(new Date()) },
      select: {
        phase: true,
        runId: true,
        submittedAt: true,
        overallComment: true,
      },
      order: { submittedAt: 'ASC' },
    });
    return {
      exportedAt: new Date(),
      comments: rows.filter((row) => row.overallComment),
    };
  }

  async purgeExpired() {
    const now = new Date();
    const [events, browsers, counters, feedback] = await Promise.all([
      this.events.delete({ retentionExpiresAt: LessThanOrEqual(now) }),
      this.browsers.delete({ expiresAt: LessThanOrEqual(now) }),
      this.counters.delete({ retentionExpiresAt: LessThanOrEqual(now) }),
      this.feedback.delete({ retentionExpiresAt: LessThanOrEqual(now) }),
    ]);
    return {
      purged: {
        events: events.affected || 0,
        browsers: browsers.affected || 0,
        counters: counters.affected || 0,
        feedback: feedback.affected || 0,
      },
    };
  }

  async metrics() {
    await this.maybePurge();
    const since = new Date(Date.now() - UX_COOKIE_MS);
    const [browsers, eventCount, events, counters, feedback] =
      await Promise.all([
        this.browsers.countBy({ expiresAt: MoreThan(new Date()) }),
        this.events.countBy({ occurredAt: MoreThan(since) }),
        this.events.find({
          where: { occurredAt: MoreThan(since) },
          order: { occurredAt: 'ASC' },
          take: UX_REPORT_EVENT_LIMIT,
        }),
        this.counters.findBy({ occurredAt: MoreThan(since) }),
        this.feedback.find({
          where: { submittedAt: MoreThan(since) },
          select: {
            visualRating: true,
            automationInterest: true,
            phase: true,
            runId: true,
          },
        }),
      ]);

    const counterTotals: Record<string, number> = {};
    const hourlyCounters: Record<string, Record<string, number>> = {};
    const hourly: Record<
      string,
      {
        hour: string;
        phase: string;
        runId: string | null;
        deviceCategory: string;
        pageviews: number;
        actions: number;
        visits: number;
        singlePageExits: number;
        engagedVisits: number;
        browsers: Set<string>;
      }
    > = {};
    const routeViews: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    const journeys: Record<string, number> = {};
    const entryPages: Record<string, number> = {};
    const exitPages: Record<string, number> = {};
    const byBrowser = new Map<string, DemoUxEventEntity[]>();

    for (const counter of counters) {
      counterTotals[counter.eventType] =
        (counterTotals[counter.eventType] || 0) + 1;
      const hour = counter.occurredAt.toISOString().slice(0, 13) + ':00Z';
      const key = `${hour}|${counter.phase}|${counter.runId || 'unassigned'}`;
      hourlyCounters[key] ||= {};
      hourlyCounters[key][counter.eventType] =
        (hourlyCounters[key][counter.eventType] || 0) + 1;
    }
    const eventHourKey = (event: DemoUxEventEntity) =>
      `${event.occurredAt.toISOString().slice(0, 13)}:00Z|${event.phase}|${event.runId || 'unassigned'}|${event.deviceCategory}`;
    for (const event of events) {
      const hour = event.occurredAt.toISOString().slice(0, 13) + ':00Z';
      const key = eventHourKey(event);
      hourly[key] ||= {
        hour,
        phase: event.phase,
        runId: event.runId,
        deviceCategory: event.deviceCategory,
        pageviews: 0,
        actions: 0,
        visits: 0,
        singlePageExits: 0,
        engagedVisits: 0,
        browsers: new Set(),
      };
      hourly[key].browsers.add(event.browserHash);
      if (event.eventType === 'PAGE_VIEW') {
        hourly[key].pageviews += 1;
        routeViews[event.route] = (routeViews[event.route] || 0) + 1;
      } else {
        hourly[key].actions += 1;
        actionCounts[event.eventType] =
          (actionCounts[event.eventType] || 0) + 1;
      }
      if (!byBrowser.has(event.browserHash))
        byBrowser.set(event.browserHash, []);
      byBrowser.get(event.browserHash)!.push(event);
    }

    let visits = 0;
    let singlePageExits = 0;
    let engagedVisits = 0;
    for (const browserEvents of byBrowser.values()) {
      let current: DemoUxEventEntity[] = [];
      let previousTime = 0;
      const finish = () => {
        if (!current.length) return;
        visits += 1;
        const bucket = hourly[eventHourKey(current[0])];
        bucket.visits += 1;
        const pages = current.filter(
          (event) => event.eventType === 'PAGE_VIEW',
        );
        if (pages.length <= 1) {
          singlePageExits += 1;
          bucket.singlePageExits += 1;
        }
        if (pages.length > 1 || current.length > pages.length) {
          engagedVisits += 1;
          bucket.engagedVisits += 1;
        }
        const first = pages[0]?.route || current[0].route;
        const last =
          pages[pages.length - 1]?.route || current[current.length - 1].route;
        entryPages[first] = (entryPages[first] || 0) + 1;
        exitPages[last] = (exitPages[last] || 0) + 1;
        for (let index = 1; index < pages.length; index += 1) {
          const journey = `${pages[index - 1].route} -> ${pages[index].route}`;
          journeys[journey] = (journeys[journey] || 0) + 1;
        }
      };
      for (const event of browserEvents) {
        if (
          current.length &&
          event.occurredAt.getTime() - previousTime > UX_VISIT_IDLE_MS
        ) {
          finish();
          current = [];
        }
        current.push(event);
        previousTime = event.occurredAt.getTime();
      }
      finish();
    }

    const funnelStages = [
      {
        name: 'PAGE_VIEW',
        matches: (event: DemoUxEventEntity) => event.eventType === 'PAGE_VIEW',
      },
      {
        name: 'RECORD_VIEW',
        matches: (event: DemoUxEventEntity) =>
          event.eventType === 'RECORD_VIEW',
      },
      {
        name: 'FORM_START',
        matches: (event: DemoUxEventEntity) => event.eventType === 'FORM_START',
      },
      {
        name: 'SUBMISSION_ATTEMPT',
        matches: (event: DemoUxEventEntity) =>
          event.eventType === 'SUBMISSION_ATTEMPT',
      },
      {
        name: 'UI_REPORTED_SUBMISSION',
        matches: (event: DemoUxEventEntity) =>
          ['ARTIFACT_SUBMITTED', 'WORKFLOW_SUBMITTED'].includes(
            event.eventType,
          ),
      },
    ];
    const reached = funnelStages.map(() => 0);
    for (const browserEvents of byBrowser.values()) {
      let cursor = 0;
      for (let index = 0; index < funnelStages.length; index += 1) {
        const found = browserEvents.findIndex(
          (event, position) =>
            position >= cursor && funnelStages[index].matches(event),
        );
        if (found < 0) break;
        reached[index] += 1;
        cursor = found + 1;
      }
    }
    const funnel = funnelStages.map((stage, index) => {
      const denominator = index === 0 ? browsers : reached[index - 1];
      return {
        stage: stage.name,
        consentingBrowsers: reached[index],
        denominator,
        dropOff: Math.max(0, denominator - reached[index]),
        conversionFromPrevious: denominator
          ? reached[index] / denominator
          : null,
      };
    });
    const surveyByPhase: Record<
      string,
      {
        submitted: number;
        visualRatings: Record<string, number>;
        automationInterest: Record<string, number>;
      }
    > = {};
    for (const row of feedback) {
      const key = `${row.phase}|${row.runId || 'unassigned'}`;
      surveyByPhase[key] ||= {
        submitted: 0,
        visualRatings: {},
        automationInterest: {},
      };
      surveyByPhase[key].submitted += 1;
      if (row.visualRating != null) {
        const rating = String(row.visualRating);
        surveyByPhase[key].visualRatings[rating] =
          (surveyByPhase[key].visualRatings[rating] || 0) + 1;
      }
      if (row.automationInterest) {
        surveyByPhase[key].automationInterest[row.automationInterest] =
          (surveyByPhase[key].automationInterest[row.automationInterest] || 0) +
          1;
      }
    }
    return {
      observedAt: new Date(),
      scope:
        'Last 30 days; analytics represent consenting browsers, not people or all visitors.',
      truncated: eventCount > UX_REPORT_EVENT_LIMIT,
      analyticsParticipation: {
        consentingBrowsers: browsers,
        consentAcceptActions: counterTotals.CONSENT_ACCEPTED || 0,
        consentRejectActions: counterTotals.CONSENT_REJECTED || 0,
        consentRevokeActions: counterTotals.CONSENT_REVOKED || 0,
        caveat: 'Accept/reject counts are button actions, not unique visitors.',
      },
      visits: {
        count: visits,
        singlePageExits,
        engaged: engagedVisits,
        idleMinutes: 30,
      },
      pageviews: events.filter((event) => event.eventType === 'PAGE_VIEW')
        .length,
      routeViews,
      entryPages,
      exitPages,
      journeys,
      actionCounts,
      funnel,
      hourly: Object.values(hourly).map((value) => ({
        hour: value.hour,
        phase: value.phase,
        runId: value.runId,
        deviceCategory: value.deviceCategory,
        pageviews: value.pageviews,
        actions: value.actions,
        visits: value.visits,
        singlePageExits: value.singlePageExits,
        engagedVisits: value.engagedVisits,
        consentingBrowsers: value.browsers.size,
      })),
      hourlyAnonymousActions: Object.entries(hourlyCounters).map(
        ([key, counts]) => ({ key, counts }),
      ),
      survey: {
        opens: counterTotals.SURVEY_OPENED || 0,
        submissions: counterTotals.SURVEY_SUBMITTED || 0,
        byPhase: surveyByPhase,
      },
      caveat:
        'Client-reported completion actions are not ledger confirmations; compare against protected operational metrics.',
    };
  }
}
