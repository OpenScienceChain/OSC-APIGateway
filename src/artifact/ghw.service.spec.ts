import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GhwService } from './ghw.service';
import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';

let observedReadTimeoutMs: number | undefined;

// Helper to create a mock IncomingMessage with minimal behavior
function createMockResponse(statusCode: number, body: string) {
  const res = new http.IncomingMessage(null as any);
  res.statusCode = statusCode as any;
  res.setTimeout = (ms: number, cb: () => void) => {
    observedReadTimeoutMs = ms;
    setTimeout(cb, 0);
    return res as any;
  };
  // Emit data and end later
  process.nextTick(() => {
    res.emit('data', body);
    res.emit('end');
  });
  return res as unknown as http.IncomingMessage;
}

function createFakeRequest() {
  const req = new EventEmitter() as any;
  req.end = () => {};
  req.destroy = (err: Error) => req.emit('error', err);
  return req as any;
}

describe('GhwService', () => {
  let service: GhwService;
  let requestSpy: jest.SpyInstance;

  beforeEach(async () => {
    observedReadTimeoutMs = undefined;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GhwService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => {
              const values: Record<string, string> = {
                GHW_NSG_URL: 'http://history-worker-nsg:8002',
                GHW_CITIZEN_SCIENCE_URL:
                  'http://history-worker-citizen-science:8002',
                GHW_MAGNETIC_ARCH_URL:
                  'http://history-worker-magnetic-arch:8002',
              };
              return values[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(GhwService);
    // Default to http
    requestSpy = jest.spyOn(http, 'request');
    jest.spyOn(https, 'request'); // ensure not used in defaults
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetchHistory sends correct query, headers, and parses JSON', async () => {
    const body = JSON.stringify({ items: [1], hasMore: true });
    requestSpy.mockImplementation(
      (options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() => cb(createMockResponse(200, body)));
        // Simulate socket connect immediately so connect timeout clears
        process.nextTick(() => {
          req.emit('socket', {
            on: (event: string, h: any) => {
              if (event === 'connect') setImmediate(h);
            },
          });
        });
        return req as any;
      },
    );

    const out = await service.fetchHistory(
      {
        artifactId: 'a',
        offset: 0,
        limit: 2,
        order: 'desc',
        includeValue: true,
      },
      'corr-1',
    );
    expect(out).toEqual({ items: [1], hasMore: true });

    const call = requestSpy.mock.calls[0][0];
    expect(call.method).toBe('GET');
    expect(call.headers['x-correlation-id']).toBe('corr-1');
    expect(call.path).toContain('artifactId=a');
    expect(call.path).toContain('assetType=artifact');
    expect(call.path).toContain('offset=0');
    expect(call.path).toContain('limit=2');
    expect(call.path).toContain('order=desc');
    expect(call.path).toContain('includeValue=true');
    expect(observedReadTimeoutMs).toBe(70000);
  });

  it('routes workflow history to the organization-bound worker', async () => {
    requestSpy.mockImplementation(
      (options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() =>
          cb(createMockResponse(200, JSON.stringify({ items: [] }))),
        );
        process.nextTick(() => {
          req.emit('socket', {
            on: (event: string, handler: any) => {
              if (event === 'connect') setImmediate(handler);
            },
          });
        });
        return req as any;
      },
    );

    await service.fetchHistory(
      {
        artifactId: 'a',
        assetType: 'workflow',
        organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        offset: 0,
        limit: 100,
        order: 'desc',
        includeValue: true,
      },
      'corr-workflow',
    );

    const call = requestSpy.mock.calls[0][0];
    expect(call.hostname).toBe('history-worker-nsg');
    expect(call.path).toContain('assetType=workflow');
  });

  it('routes magnetic arch history to its own worker', async () => {
    requestSpy.mockImplementation(
      (options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() =>
          cb(createMockResponse(200, JSON.stringify({ items: [] }))),
        );
        process.nextTick(() => {
          req.emit('socket', {
            on: (event: string, handler: any) => {
              if (event === 'connect') setImmediate(handler);
            },
          });
        });
        return req as any;
      },
    );

    await service.fetchHistory(
      {
        artifactId: 'a',
        organizationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        offset: 0,
        limit: 10,
        order: 'desc',
        includeValue: false,
      },
      'corr-magnetic',
    );

    expect(requestSpy.mock.calls[0][0].hostname).toBe(
      'history-worker-magnetic-arch',
    );
  });

  it('maps non-2xx status to error with statusCode', async () => {
    requestSpy.mockImplementation(
      (_options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() => cb(createMockResponse(502, 'oops')));
        process.nextTick(() => {
          req.emit('socket', { on: (_: any, h: any) => setImmediate(h) });
        });
        return req as any;
      },
    );

    await expect(
      service.fetchHistory(
        {
          artifactId: 'a',
          offset: 0,
          limit: 1,
          order: 'asc',
          includeValue: false,
        },
        'c',
      ),
    ).rejects.toMatchObject({ message: 'UPSTREAM_502', statusCode: 502 });
  });

  it('propagates JSON.parse errors as Error instances for invalid JSON', async () => {
    requestSpy.mockImplementation(
      (_options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() => cb(createMockResponse(200, '{not-json')));
        process.nextTick(() => {
          req.emit('socket', { on: (_: any, h: any) => setImmediate(h) });
        });
        return req as any;
      },
    );

    await expect(
      service.fetchHistory(
        {
          artifactId: 'a',
          offset: 0,
          limit: 1,
          order: 'asc',
          includeValue: false,
        },
        'c',
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('times out on read (READ_TIMEOUT)', async () => {
    requestSpy.mockImplementation(
      (options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        // Emit socket connect to clear connect-timeout timer
        process.nextTick(() => {
          req.emit('socket', {
            on: (event: string, h: any) => {
              if (event === 'connect') setImmediate(h);
            },
          });
        });

        // Mock res with setTimeout calling handler immediately
        const res: any = new http.IncomingMessage(null as any);
        res.setTimeout = (_ms: number, handler: () => void) => {
          handler();
          return res;
        };
        // Make destroy emit error
        req.destroy = (err: Error) => req.emit('error', err);

        process.nextTick(() => cb(res));
        return req as any;
      },
    );

    await expect(
      service.fetchHistory(
        {
          artifactId: 'a',
          offset: 0,
          limit: 1,
          order: 'asc',
          includeValue: false,
        },
        'c',
      ),
    ).rejects.toMatchObject({ message: 'READ_TIMEOUT' });
  });

  it('times out on connect (CONNECT_TIMEOUT)', async () => {
    requestSpy.mockImplementation(() => {
      const req = createFakeRequest();
      // simulate connect timeout by emitting error soon after
      process.nextTick(() => req.emit('error', new Error('CONNECT_TIMEOUT')));
      return req as any;
    });

    await expect(
      service.fetchHistory(
        {
          artifactId: 'a',
          offset: 0,
          limit: 1,
          order: 'asc',
          includeValue: false,
        },
        'c',
      ),
    ).rejects.toMatchObject({ message: 'CONNECT_TIMEOUT' });
  });

  it('refresh uses /history/refresh endpoint and parses response', async () => {
    requestSpy.mockImplementation(
      (options: any, cb: (res: http.IncomingMessage) => void) => {
        const req = createFakeRequest();
        process.nextTick(() =>
          cb(createMockResponse(200, JSON.stringify({ ok: true }))),
        );
        process.nextTick(() => {
          req.emit('socket', {
            on: (event: string, h: any) => {
              if (event === 'connect') setImmediate(h);
            },
          });
        });
        return req as any;
      },
    );

    const out = await service.refresh('abc', 'corr');
    expect(out).toEqual({ ok: true });
    const call = requestSpy.mock.calls[0][0];
    expect(call.path).toContain('/history/refresh');
    expect(call.path).toContain('artifactId=abc');
  });
});
