import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DemoService } from '../demo.service';

@Injectable()
export class DemoOriginGuard implements CanActivate {
  constructor(private readonly demoService: DemoService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.headers.origin !== this.demoService.allowedOrigin) {
      throw new ForbiddenException(
        'The request origin is not allowed for demonstration mutations',
      );
    }
    return true;
  }
}
