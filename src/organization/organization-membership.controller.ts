import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guards';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { Roles } from '../shared/decorators/roles.decorators';
import { Role } from '../shared/enums/role.enums';
import { OrganizationMembershipService } from './organization-membership.service';
import {
  CreateOrganizationMembershipDto,
  UpdateOrganizationMembershipDto,
} from './organization-membership.dto';

@Controller('organizations/:organizationId/memberships')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard, RolesGuard)
@Roles(Role.ADMIN)
export class OrganizationMembershipController {
  constructor(
    private readonly membershipService: OrganizationMembershipService,
  ) {}

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.membershipService.findByOrganization(organizationId);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateOrganizationMembershipDto,
  ) {
    return this.membershipService.create(organizationId, dto);
  }

  @Patch(':membershipId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateOrganizationMembershipDto,
  ) {
    return this.membershipService.update(organizationId, membershipId, dto);
  }
}
