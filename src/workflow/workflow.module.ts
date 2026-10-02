import { Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowEntity } from './workflow.entity';
import { OrganizationEntity } from '../organization/organization.entity';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { MessagingModule } from '../messaging/messaging.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowEntity,
      OrganizationEntity,
      ArtifactEntity,
    ]),
    MessagingModule,
    ConfigModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
