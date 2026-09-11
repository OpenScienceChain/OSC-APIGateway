import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface HistoryQuery {
  artifactId: string;
  assetType?: 'artifact' | 'workflow';
  organizationId?: string;
  offset: number;
  limit: number;
  order: 'asc' | 'desc';
  includeValue: boolean;
}

@Injectable()
export class GhwService {
  private readonly defaultBaseUrl: string;
  private readonly nsgBaseUrl: string;
  private readonly citizenScienceBaseUrl: string;
  private readonly nsgOrganizationId: string;
  private readonly citizenScienceOrganizationId: string;

  constructor(private readonly configService: ConfigService) {
    this.defaultBaseUrl = this.configService.get<string>(
      'GHW_URL',
      'http://localhost:8002',
    );
    this.nsgBaseUrl = this.configService.get<string>('GHW_NSG_URL', '');
    this.citizenScienceBaseUrl = this.configService.get<string>(
      'GHW_CITIZEN_SCIENCE_URL',
      '',
    );
    this.nsgOrganizationId = this.configService.get<string>(
      'NSG_ORGANIZATION_ID',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    this.citizenScienceOrganizationId = this.configService.get<string>(
      'CITIZEN_SCIENCE_ORGANIZATION_ID',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
  }

  private baseUrlFor(organizationId?: string): string {
    if (organizationId === this.nsgOrganizationId && this.nsgBaseUrl) {
      return this.nsgBaseUrl;
    }
    if (
      organizationId === this.citizenScienceOrganizationId &&
      this.citizenScienceBaseUrl
    ) {
      return this.citizenScienceBaseUrl;
    }
    return this.defaultBaseUrl;
  }

  async fetchHistory(query: HistoryQuery, correlationId: string): Promise<any> {
    const url = new URL('/history', this.baseUrlFor(query.organizationId));
    url.searchParams.set('artifactId', query.artifactId);
    url.searchParams.set('assetType', query.assetType || 'artifact');
    url.searchParams.set('offset', String(query.offset));
    url.searchParams.set('limit', String(query.limit));
    url.searchParams.set('order', query.order);
    url.searchParams.set('includeValue', String(query.includeValue));
    return this.getJson(url.toString(), correlationId);
  }

  async refresh(
    artifactId: string,
    correlationId: string,
    organizationId?: string,
    assetType: 'artifact' | 'workflow' = 'artifact',
  ): Promise<any> {
    const url = new URL('/history/refresh', this.baseUrlFor(organizationId));
    url.searchParams.set('artifactId', artifactId);
    url.searchParams.set('assetType', assetType);
    return this.getJson(url.toString(), correlationId);
  }

  private async getJson(fullUrl: string, correlationId: string): Promise<any> {
    const url = new URL(fullUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const connectTimeoutMs = 2000;
    // The history worker can legitimately spend up to 60 seconds waiting on
    // Fabric, so the Gateway must not abandon a healthy upstream first.
    const readTimeoutMs = 70000;

    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          accept: 'application/json',
          'x-correlation-id': correlationId,
          connection: 'keep-alive',
        },
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.setEncoding('utf8');

        // Read timeout
        res.setTimeout(readTimeoutMs, () => {
          req.destroy(new Error('READ_TIMEOUT'));
        });

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const status = res.statusCode || 500;
            if (status < 200 || status >= 300) {
              const err = new Error(`UPSTREAM_${status}`);
              (err as any).statusCode = status;
              (err as any).body = data;
              reject(err);
              return;
            }
            const json = data ? JSON.parse(data) : {};
            resolve(json);
          } catch (e) {
            let error: Error;
            if (e instanceof Error) {
              error = e;
            } else if (typeof e === 'string') {
              error = new Error(e);
            } else {
              error = new Error('INVALID_JSON');
            }
            reject(error);
          }
        });
      });

      // Connect timeout
      const connectTimer = setTimeout(() => {
        req.destroy(new Error('CONNECT_TIMEOUT'));
      }, connectTimeoutMs);
      // Do not keep the event loop alive because of this timer
      (connectTimer as any)?.unref?.();

      req.on('socket', (socket) => {
        socket.on('connect', () => {
          clearTimeout(connectTimer);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }
}
