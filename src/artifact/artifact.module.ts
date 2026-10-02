import { Module } from '@nestjs/common';
import { ArtifactService } from './artifact.service';
import { ArtifactController } from './artifact.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArtifactEntity } from './artifact.entity';
import { OrganizationEntity } from '../organization/organization.entity';
import { MessagingModule } from '../messaging/messaging.module';
import { ConfigModule } from '@nestjs/config';
import { GhwService } from './ghw.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ArtifactEntity, OrganizationEntity]),
    MessagingModule,
    ConfigModule,
  ],
  controllers: [ArtifactController],
  providers: [ArtifactService, GhwService],
  exports: [ArtifactService, GhwService],
})
export class ArtifactModule {}
