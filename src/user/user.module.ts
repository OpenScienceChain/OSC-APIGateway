import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from '../auth/auth.module';
import { OrganizationModule } from '../organization/organization.module';
import { OrganizationEntity } from '../organization/organization.entity';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      OrganizationEntity,
      OrganizationMembershipEntity,
    ]),
    AuthModule,
    OrganizationModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
