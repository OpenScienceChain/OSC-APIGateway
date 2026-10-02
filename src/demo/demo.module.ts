import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { ArtifactModule } from '../artifact/artifact.module';
import { OrganizationEntity } from '../organization/organization.entity';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { WorkflowModule } from '../workflow/workflow.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoContributionEntity } from './entities/demo-contribution.entity';
import { DemoArtifactEditEntity } from './entities/demo-artifact-edit.entity';
import { DemoEventEntity } from './entities/demo-event.entity';
import { DemoFeedbackEntity } from './entities/demo-feedback.entity';
import { DemoRuntimeEntity } from './entities/demo-runtime.entity';
import { DemoSessionEntity } from './entities/demo-session.entity';
import { DemoAccountEntity } from './entities/demo-account.entity';
import { DemoUxBrowserEntity } from './entities/demo-ux-browser.entity';
import { DemoUxEventEntity } from './entities/demo-ux-event.entity';
import { DemoUxCounterEntity } from './entities/demo-ux-counter.entity';
import { DemoUxFeedbackEntity } from './entities/demo-ux-feedback.entity';
import { DemoUxController } from './demo-ux.controller';
import { DemoUxService } from './demo-ux.service';
import { DemoAuthGuard } from './guards/demo-auth.guard';
import { DemoControlGuard } from './guards/demo-control.guard';
import { DemoMutationGuard } from './guards/demo-mutation.guard';
import { DemoOriginGuard } from './guards/demo-origin.guard';

@Module({
  imports: [
    JwtModule.register({}),
    ArtifactModule,
    WorkflowModule,
    TypeOrmModule.forFeature([
      DemoSessionEntity,
      DemoAccountEntity,
      DemoRuntimeEntity,
      DemoEventEntity,
      DemoFeedbackEntity,
      DemoContributionEntity,
      DemoArtifactEditEntity,
      DemoUxBrowserEntity,
      DemoUxEventEntity,
      DemoUxCounterEntity,
      DemoUxFeedbackEntity,
      OrganizationEntity,
      ArtifactEntity,
      WorkflowEntity,
    ]),
  ],
  controllers: [DemoController, DemoUxController],
  providers: [
    DemoService,
    DemoAuthGuard,
    DemoMutationGuard,
    DemoOriginGuard,
    DemoControlGuard,
    DemoUxService,
  ],
  exports: [DemoService],
})
export class DemoModule {}
