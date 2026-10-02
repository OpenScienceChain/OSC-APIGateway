import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { ArtifactModule } from '../artifact/artifact.module';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { ShowcaseController } from './showcase.controller';
import { ShowcaseService } from './showcase.service';

@Module({
  imports: [
    ArtifactModule,
    TypeOrmModule.forFeature([ArtifactEntity, WorkflowEntity]),
  ],
  controllers: [ShowcaseController],
  providers: [ShowcaseService],
})
export class ShowcaseModule {}
