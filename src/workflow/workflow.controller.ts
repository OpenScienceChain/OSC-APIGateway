import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Patch,
  UseInterceptors,
  UseGuards,
  Req,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { WorkflowEntity } from './workflow.entity';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { UpdateWorkflowWorkerDto } from './dto/update-workflow-worker.dto';
import { GetWorkflowDto } from './dto/get-workflow.dto';
import { ListWorkflowDto } from './dto/list-workflow.dto';
import { BusinessErrorsInterceptor } from '../shared/interceptors/business-errors.interceptors';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../auth/guards/api-key-auth/api-key-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guards';
import { Roles } from '../shared/decorators/roles.decorators';
import { Role } from '../shared/enums/role.enums';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@Controller('workflows')
@UseInterceptors(BusinessErrorsInterceptor)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PI, Role.COLLABORATOR)
  async create(
    @Req() req: any,
    @Body() createWorkflowDto: CreateWorkflowDto,
    @Headers('x-correlation-id') corrId?: string,
  ): Promise<ListWorkflowDto> {
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

    const submitterInfo = {
      userId: req.user.id,
      username: req.user.username,
      email: req.user.email,
      organizationId: req.user.organizationId,
    };

    return await this.workflowService.create(
      createWorkflowDto,
      submitterInfo,
      corrId,
    );
  }

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async findAll(@Req() req: any = {}): Promise<ListWorkflowDto[]> {
    return await this.workflowService.findAll(req.user?.organizationId);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  async findOne(
    @Param('id') id: string,
    @Req() req: any = {},
  ): Promise<GetWorkflowDto> {
    return await this.workflowService.findOne(id, req.user?.organizationId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PI, Role.COLLABORATOR)
  // The workFlow is Updated By a User. No User is being updated here.
  async updateUser(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateWorkflowDto: UpdateWorkflowDto,
    @Headers('x-correlation-id') corrId?: string,
  ): Promise<WorkflowEntity> {
    return await this.workflowService.updateUser(
      id,
      updateWorkflowDto,
      req?.user?.email,
      corrId,
      req?.user?.organizationId,
      req?.user?.id,
    );
  }

  @Patch(':id')
  @UseGuards(ApiKeyAuthGuard, RolesGuard)
  @Roles(Role.SUBMITTER_LISTENER)
  async updateWorker(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateWorkflowWorkerDto,
  ): Promise<WorkflowEntity> {
    return await this.workflowService.updateWorker(id, updateStatusDto);
  }
}
