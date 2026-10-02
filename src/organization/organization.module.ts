import { Module } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { OrganizationEntity } from './organization.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationController } from './organization.controller';
import { OrganizationMembershipEntity } from './organization-membership.entity';
import { UserEntity } from '../user/user.entity';
import { OrganizationMembershipService } from './organization-membership.service';
import { OrganizationMembershipController } from './organization-membership.controller';
import {
  OrganizationScopeGuard,
  PlatformAdminGuard,
} from '../auth/guards/organization-scope.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      OrganizationMembershipEntity,
      UserEntity,
    ]),
  ],
  providers: [
    OrganizationService,
    OrganizationMembershipService,
    OrganizationScopeGuard,
    PlatformAdminGuard,
  ],
  controllers: [OrganizationController, OrganizationMembershipController],
})
export class OrganizationModule {}
