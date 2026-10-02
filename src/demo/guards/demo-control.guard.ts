import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DemoService } from '../demo.service';

@Injectable()
export class DemoControlGuard implements CanActivate {
  constructor(private readonly demoService: DemoService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    this.demoService.verifyControlKey(
      request.headers['x-demo-control-key'] as string | undefined,
    );
    return true;
  }
}
