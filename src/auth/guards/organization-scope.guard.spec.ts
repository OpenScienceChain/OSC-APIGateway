import { ForbiddenException } from '@nestjs/common';
import {
  OrganizationScopeGuard,
  PlatformAdminGuard,
} from './organization-scope.guard';

function context(request: any): any {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe('OrganizationScopeGuard', () => {
  const guard = new OrganizationScopeGuard();

  it('allows the active organization', () => {
    expect(
      guard.canActivate(
        context({
          user: { organizationId: 'nsg', platformAdmin: false },
          params: { organizationId: 'nsg' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects an administrator targeting another organization', () => {
    expect(() =>
      guard.canActivate(
        context({
          user: { organizationId: 'nsg', platformAdmin: false },
          params: { organizationId: 'citizen-science' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows a platform administrator to bootstrap an organization', () => {
    expect(
      guard.canActivate(
        context({
          user: { platformAdmin: true },
          params: { organizationId: 'citizen-science' },
        }),
      ),
    ).toBe(true);
  });
});

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();

  it('rejects an organization administrator', () => {
    expect(() =>
      guard.canActivate(context({ user: { platformAdmin: false } })),
    ).toThrow(ForbiddenException);
  });
});
