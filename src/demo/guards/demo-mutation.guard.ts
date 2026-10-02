import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DemoService } from '../demo.service';
import { DemoPrincipal } from '../demo.types';

@Injectable()
export class DemoMutationGuard implements CanActivate {
  constructor(private readonly demoService: DemoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const principal = request.user as DemoPrincipal;
    await this.demoService.verifyMutation(
      principal,
      request.headers['x-demo-csrf'] as string | undefined,
    );
    return true;
  }
}
