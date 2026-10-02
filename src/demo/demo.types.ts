import { Role } from '../shared/enums/role.enums';

export interface DemoPrincipal {
  isDemo: true;
  tokenSubject: string;
  sessionId: string;
  sessionHash: string;
  accountId?: string;
  organizationId: string;
  organizationSlug: string;
  contributorAlias: string;
  roles: [Role.DEMO_CONTRIBUTOR];
  expiresAt: Date;
}

export interface DemoTokenPayload {
  sub: string;
  organizationId: string;
  organizationSlug: string;
  role: Role.DEMO_CONTRIBUTOR;
}

export interface DemoSessionResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  organization: string;
  contributorAlias: string;
  accountUsername?: string;
}
