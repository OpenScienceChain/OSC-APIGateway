import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { Repository } from 'typeorm';
import { DemoUxController } from './demo-ux.controller';
import { DemoUxService } from './demo-ux.service';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';
import { DemoUxBrowserEntity } from './entities/demo-ux-browser.entity';
import { DemoUxCounterEntity } from './entities/demo-ux-counter.entity';
import { DemoUxEventEntity } from './entities/demo-ux-event.entity';
import { DemoUxFeedbackEntity } from './entities/demo-ux-feedback.entity';
import { DemoControlGuard } from './guards/demo-control.guard';
import { DemoOriginGuard } from './guards/demo-origin.guard';
import { getRepositoryToken } from '@nestjs/typeorm';

const ORIGIN = 'https://demo.osc-staging.org';
const CONTROL_KEY = 'control-key-32-characters-for-tests';

describe('anonymous UX measurement', () => {
  let app: INestApplication;
  let browsers: Repository<DemoUxBrowserEntity>;
  let events: Repository<DemoUxEventEntity>;
  let feedback: Repository<DemoUxFeedbackEntity>;

  beforeEach(async () => {
    const entities = [
      DemoRuntimeEntity,
      DemoUxBrowserEntity,
      DemoUxEventEntity,
      DemoUxCounterEntity,
      DemoUxFeedbackEntity,
    ];
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          dropSchema: true,
          entities,
          synchronize: true,
        }),
        TypeOrmModule.forFeature(entities),
      ],
      controllers: [DemoUxController],
      providers: [
        DemoUxService,
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              ({
                DEMO_ANALYTICS_HMAC_SECRET:
                  'analytics-secret-32-characters-tests',
                DEMO_UX_RUN_PHASE: 'REHEARSAL',
              })[name],
          },
        },
      ],
    })
      .overrideGuard(DemoOriginGuard)
      .useValue({
        canActivate: (context) =>
          context.switchToHttp().getRequest().headers.origin === ORIGIN,
      })
      .overrideGuard(DemoControlGuard)
      .useValue({
        canActivate: (context) =>
          context.switchToHttp().getRequest().headers['x-demo-control-key'] ===
          CONTROL_KEY,
      })
      .compile();
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
    browsers = module.get(getRepositoryToken(DemoUxBrowserEntity));
    events = module.get(getRepositoryToken(DemoUxEventEntity));
    feedback = module.get(getRepositoryToken(DemoUxFeedbackEntity));
  });

  afterEach(async () => {
    await app.close();
  });

  const metricRequest = (server) =>
    request(server)
      .get('/api/v1/demo/internal/ux-metrics')
      .set('x-demo-control-key', CONTROL_KEY);

  it('records only allowlisted events after consent and deletes browser history on revoke', async () => {
    const server = app.getHttpServer();
    const event = {
      eventType: 'PAGE_VIEW',
      route: '/list-artifacts',
      deviceCategory: 'DESKTOP',
    };
    await request(server)
      .post('/api/v1/demo/analytics/events')
      .set('Origin', ORIGIN)
      .send(event)
      .expect(403);
    const consent = await request(server)
      .post('/api/v1/demo/analytics/session')
      .set('Origin', ORIGIN)
      .expect(201);
    const cookie = consent.headers['set-cookie'][0].split(';')[0];
    expect(cookie).toMatch(/^__Host-osc_ux=/);
    expect(consent.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(consent.headers['set-cookie'][0]).toContain('Secure');
    await request(server)
      .post('/api/v1/demo/analytics/events')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ ...event, route: '/view-artifact/a-real-record-id' })
      .expect(400);
    await request(server)
      .post('/api/v1/demo/analytics/events')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send({ ...event, searchText: 'private query' })
      .expect(400);
    await request(server)
      .post('/api/v1/demo/analytics/events')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .send(event)
      .expect(201);
    expect(await events.count()).toBe(1);
    const before = await metricRequest(server).expect(200);
    expect(before.body.pageviews).toBe(1);
    expect(before.body.visits.count).toBe(1);
    expect(before.body.analyticsParticipation.consentingBrowsers).toBe(1);
    await request(server)
      .delete('/api/v1/demo/analytics/session')
      .set('Origin', ORIGIN)
      .set('Cookie', cookie)
      .expect(200);
    expect(await events.count()).toBe(0);
    const after = await metricRequest(server).expect(200);
    expect(after.body.analyticsParticipation.consentingBrowsers).toBe(0);
    expect(after.body.pageviews).toBe(0);
  });

  it('allows a declined-analytics visitor to submit one optional survey answer without a session', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/demo/analytics/reject')
      .set('Origin', ORIGIN)
      .expect(201);
    await request(server)
      .post('/api/v1/demo/ux-feedback/view')
      .set('Origin', ORIGIN)
      .expect(201);
    await request(server)
      .post('/api/v1/demo/ux-feedback')
      .set('Origin', ORIGIN)
      .send({ overallComment: 'The navigation is clear.' })
      .expect(201);
    const row = await feedback.findOneByOrFail({
      overallComment: 'The navigation is clear.',
    });
    expect(row.visualRating).toBeNull();
    expect(row.automationInterest).toBeNull();
    expect(Object.keys(row)).not.toContain('browserHash');
    expect(Object.keys(row)).not.toContain('organizationId');
    await request(server)
      .post('/api/v1/demo/ux-feedback')
      .set('Origin', ORIGIN)
      .send({ overallComment: '  ' })
      .expect(400);
    const metrics = await metricRequest(server).expect(200);
    expect(metrics.body.analyticsParticipation.consentRejectActions).toBe(1);
    expect(metrics.body.survey.opens).toBe(1);
    expect(metrics.body.survey.submissions).toBe(1);
    expect(metrics.body.analyticsParticipation.consentingBrowsers).toBe(0);
    await request(server)
      .get('/api/v1/demo/internal/ux-feedback/comments')
      .expect(403);
    const exportResponse = await request(server)
      .get('/api/v1/demo/internal/ux-feedback/comments')
      .set('x-demo-control-key', CONTROL_KEY)
      .expect(200);
    expect(exportResponse.body.comments[0].overallComment).toBe(
      'The navigation is clear.',
    );
  });

  it('uses ordered browser stages and a 30-minute inactivity boundary for visits', async () => {
    const server = app.getHttpServer();
    const consent = await request(server)
      .post('/api/v1/demo/analytics/session')
      .set('Origin', ORIGIN)
      .expect(201);
    const cookie = consent.headers['set-cookie'][0].split(';')[0];
    const actions = [
      ['PAGE_VIEW', '/'],
      ['RECORD_VIEW', '/artifacts/:id'],
      ['FORM_START', '/contribute'],
      ['SUBMISSION_ATTEMPT', '/contribute'],
      ['ARTIFACT_SUBMITTED', '/contribute'],
      ['PAGE_VIEW', '/list-artifacts'],
    ];
    for (const [eventType, route] of actions) {
      await request(server)
        .post('/api/v1/demo/analytics/events')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({ eventType, route, deviceCategory: 'MOBILE' })
        .expect(201);
    }
    const initial = await metricRequest(server).expect(200);
    expect(initial.body.visits).toMatchObject({ count: 1, engaged: 1 });
    expect(initial.body.journeys['/ -> /list-artifacts']).toBe(1);
    expect(
      initial.body.funnel.map((stage) => stage.consentingBrowsers),
    ).toEqual([1, 1, 1]);
    expect(
      initial.body.explorationFunnel.map((stage) => stage.consentingBrowsers),
    ).toEqual([1, 1, 0]);
    const allEvents = await events.find({ order: { occurredAt: 'ASC' } });
    await events.update(allEvents[allEvents.length - 1].id, {
      occurredAt: new Date(Date.now() + 31 * 60_000),
    });
    const later = await metricRequest(server).expect(200);
    expect(later.body.visits.count).toBe(2);
    expect(later.body.entryPages['/list-artifacts']).toBe(1);
    expect(later.body.hourly[0].deviceCategory).toBe('MOBILE');
  });

  it('counts direct form contributions without requiring record exploration or an active cookie', async () => {
    const server = app.getHttpServer();
    const consent = await request(server)
      .post('/api/v1/demo/analytics/session')
      .set('Origin', ORIGIN)
      .expect(201);
    const cookie = consent.headers['set-cookie'][0].split(';')[0];
    for (const eventType of [
      'FORM_START',
      'SUBMISSION_ATTEMPT',
      'WORKFLOW_SUBMITTED',
    ]) {
      await request(server)
        .post('/api/v1/demo/analytics/events')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({
          eventType,
          route: '/create-workflow',
          deviceCategory: 'DESKTOP',
        })
        .expect(201);
    }
    const row = await browsers.findOneByOrFail({});
    await browsers.update(row.browserHash, { expiresAt: new Date(0) });
    const report = await metricRequest(server).expect(200);
    expect(report.body.analyticsParticipation).toMatchObject({
      consentingBrowsers: 1,
      activeConsentCookies: 0,
    });
    expect(report.body.funnel.map((stage) => stage.consentingBrowsers)).toEqual(
      [1, 1, 1],
    );
    expect(report.body.funnel[0].denominator).toBe(1);
    expect(report.body.explorationFunnel[0].consentingBrowsers).toBe(0);
  });

  it('purges expired anonymous data', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/demo/ux-feedback')
      .set('Origin', ORIGIN)
      .send({ visualRating: 4 })
      .expect(201);
    const rows = await feedback.find();
    await feedback.update(rows[0].id, { retentionExpiresAt: new Date(0) });
    await request(server)
      .post('/api/v1/demo/internal/ux-purge')
      .set('x-demo-control-key', CONTROL_KEY)
      .expect(201);
    expect(await feedback.count()).toBe(0);
  });
});
