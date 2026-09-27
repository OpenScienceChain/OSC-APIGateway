import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureCors } from './cors-origin';

@Controller('cors-test')
class CorsTestController {
  @Get()
  read() {
    return { ok: true };
  }
}

describe('CORS origin denial', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [CorsTestController],
    }).compile();
    app = module.createNestApplication();
    configureCors(app, 'https://app.example', 'https://demo.example');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a generic 403 without CORS approval for a disallowed Origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/cors-test')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(response.body).toEqual({
      statusCode: 403,
      message: 'Origin is not allowed',
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/evil|stack|error/i);
    await request(app.getHttpServer())
      .options('/cors-test')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect(403);
  });

  it('preserves allowed Origin reads and preflight', async () => {
    const response = await request(app.getHttpServer())
      .get('/cors-test')
      .set('Origin', 'https://demo.example')
      .expect(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://demo.example',
    );
    await request(app.getHttpServer())
      .options('/cors-test')
      .set('Origin', 'https://app.example')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
  });
});
