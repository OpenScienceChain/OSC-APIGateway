import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
  ): TUser | null {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers?.authorization;
    if (authorization && (err || !user)) {
      throw err || new UnauthorizedException(info?.message || 'Invalid token');
    }
    return (user || null) as TUser | null;
  }
}
