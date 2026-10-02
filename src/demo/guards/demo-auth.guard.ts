import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DEMO_COOKIE_NAME } from '../demo.constants';
import { DemoService } from '../demo.service';

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@Injectable()
export class DemoAuthGuard implements CanActivate {
  constructor(private readonly demoService: DemoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = cookieValue(request.headers.cookie, DEMO_COOKIE_NAME);
    if (!token)
      throw new UnauthorizedException(
        'Demonstration session cookie is required',
      );
    request.user = await this.demoService.authenticate(token);
    return true;
  }
}
