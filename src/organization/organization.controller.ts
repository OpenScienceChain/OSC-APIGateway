import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';

import { BusinessErrorsInterceptor } from '../shared/interceptors/business-errors.interceptors';
import { OrganizationService } from './organization.service';
import { OrganizationEntity } from './organization.entity';
import { OrganizationDto } from './organization.dto';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guards';
import { Roles } from '../shared/decorators/roles.decorators';
import { Role } from '../shared/enums/role.enums';
import {
  OrganizationScopeGuard,
  PlatformAdminGuard,
} from '../auth/guards/organization-scope.guard';

@Controller('organizations')
@UseInterceptors(BusinessErrorsInterceptor)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  // Get All Organizations
  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    return await this.organizationService.findAll();
  }

  // Get One
  @Get(':organizationId')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('organizationId') organizationId: string) {
    return await this.organizationService.findOne(organizationId);
  }

  // Create
  @Post()
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  async create(@Body() organizationDto: OrganizationDto) {
    const organization: OrganizationEntity = plainToInstance(
      OrganizationEntity,
      organizationDto,
    );
    return await this.organizationService.create(organization);
  }

  // Update
  @Put(':organizationId')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async update(
    @Param('organizationId') organizationId: string,
    @Body() organizationDto: OrganizationDto,
  ) {
    const organization: OrganizationEntity = plainToInstance(
      OrganizationEntity,
      organizationDto,
    );
    return await this.organizationService.update(organizationId, organization);
  }

  // Delete
  @Delete(':organizationId')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(204)
  async delete(@Param('organizationId') organizationId: string) {
    return this.organizationService.delete(organizationId);
  }

  // Delete all organizations
  @Delete()
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @HttpCode(204)
  async deleteAll() {
    await this.organizationService.deleteAll();
  }
}
