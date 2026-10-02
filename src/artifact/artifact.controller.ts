import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Patch,
  UseInterceptors,
  UseGuards,
  Req,
  UnauthorizedException,
  Query,
  Headers,
} from '@nestjs/common';
import { ArtifactService } from './artifact.service';
import { ArtifactEntity } from './artifact.entity';
import { CreateArtifactDto } from './dto/create-artifact.dto';
import { UpdateArtifactWorkerDto } from './dto/update-artifact-worker.dto';

import { GetArtifactDto } from './dto/get-artifact.dto';
import { BusinessErrorsInterceptor } from '../shared/interceptors/business-errors.interceptors';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../auth/guards/api-key-auth/api-key-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guards';
import { Roles } from '../shared/decorators/roles.decorators';
import { Role } from '../shared/enums/role.enums';
import { UpdateArtifactUserDto } from './dto/update-artifact-user.dto';
import { GhwService } from './ghw.service';
import { ListArtifactDto } from './dto/list-artifact.dto';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@Controller('artifacts')
@UseInterceptors(BusinessErrorsInterceptor)
export class ArtifactController {
  constructor(
    private readonly artifactService: ArtifactService,
    private readonly ghwService: GhwService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PI, Role.COLLABORATOR)
  async create(
    @Req() req: any,
    @Body() createArtifactDto: CreateArtifactDto,
    @Headers('x-correlation-id') corrId?: string,
  ): Promise<import('./dto/list-artifact.dto').ListArtifactDto> {
    if (
      !req.user ||
      !req.user.id ||
      !req.user.username ||
      !req.user.email ||
      !req.user.organizationId
    ) {
      throw new UnauthorizedException(
        'User or organization information is missing from token',
      );
    }

    // Extraer username y email directamente del token JWT
    const submitterInfo = {
      userId: req.user.id,
      username: req.user.username,
      email: req.user.email,
      organizationId: req.user.organizationId,
    };

    return await this.artifactService.create(
      createArtifactDto,
      submitterInfo,
      corrId,
    );
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async findAll(@Req() req: any = {}): Promise<ListArtifactDto[]> {
    return await this.artifactService.findAll(req.user?.organizationId);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async findOne(
    @Param('id') id: string,
    @Req() req: any = {},
  ): Promise<GetArtifactDto> {
    return await this.artifactService.findOne(id, req.user?.organizationId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async delete(@Param('id') id: string, @Req() req: any = {}): Promise<void> {
    return await this.artifactService.delete(id, req.user?.organizationId);
  }

  @Patch(':id')
  @UseGuards(ApiKeyAuthGuard, RolesGuard)
  @Roles(Role.SUBMITTER_LISTENER)
  async updateWorker(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateArtifactWorkerDto,
  ): Promise<ArtifactEntity> {
    return await this.artifactService.updateWorker(id, updateStatusDto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PI, Role.COLLABORATOR)
  async updateUser(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateArtifactDetailsDto: UpdateArtifactUserDto,
    @Headers('x-correlation-id') corrId?: string,
  ): Promise<ArtifactEntity> {
    return await this.artifactService.updateUser(
      id,
      updateArtifactDetailsDto,
      req?.user?.email,
      corrId,
      req?.user?.organizationId,
      req?.user?.id,
    );
  }

  @Get(':id/history')
  @UseGuards(JwtAuthGuard)
  async getHistory(
    @Param('id') id: string,
    @Query('offset') offsetQ?: string,
    @Query('limit') limitQ?: string,
    @Query('order') orderQ?: 'asc' | 'desc',
    @Query('includeValue') includeValueQ?: string,
    @Headers('x-correlation-id') corrId?: string,
    @Req() req: any = {},
  ): Promise<any> {
    return this.artifactService.getHistory(
      id,
      {
        offset: offsetQ,
        limit: limitQ,
        order: orderQ,
        includeValue: includeValueQ,
      },
      corrId,
      req.user?.organizationId,
    );
  }

  @Post(':id/history/refresh')
  @UseGuards(JwtAuthGuard)
  async refreshHistory(
    @Param('id') id: string,
    @Headers('x-correlation-id') corrId?: string,
    @Req() req: any = {},
  ): Promise<any> {
    return this.artifactService.refreshHistory(
      id,
      corrId,
      req.user?.organizationId,
    );
  }
}
