import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.user?.platformAdmin === true) return true;

    const requestedOrganizationId =
      request.params?.organizationId || request.body?.organizationId;
    if (
      !requestedOrganizationId ||
      requestedOrganizationId !== request.user?.organizationId
    ) {
      throw new ForbiddenException(
        'The operation is outside the active organization',
      );
    }
    return true;
  }
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.user?.platformAdmin !== true) {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
