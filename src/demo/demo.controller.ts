import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DEMO_COOKIE_NAME } from './demo.constants';
import { DemoContributionType } from './demo.enums';
import { DemoService } from './demo.service';
import { DemoPrincipal, DemoSessionResult } from './demo.types';
import { CreateDemoArtifactDto } from './dto/create-demo-artifact.dto';
import { CreateDemoEventDto } from './dto/create-demo-event.dto';
import { CreateDemoFeedbackDto } from './dto/create-demo-feedback.dto';
import { CreateDemoSessionDto } from './dto/create-demo-session.dto';
import { CreateDemoWorkflowDto } from './dto/create-demo-workflow.dto';
import { UpdateDemoStatusDto } from './dto/update-demo-status.dto';
import { DemoAuthGuard } from './guards/demo-auth.guard';
import { DemoControlGuard } from './guards/demo-control.guard';
import { DemoMutationGuard } from './guards/demo-mutation.guard';
import { DemoOriginGuard } from './guards/demo-origin.guard';

type DemoRequest = Request & { user: DemoPrincipal };

@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  private setSessionCookie(response: Response, result: DemoSessionResult) {
    response.cookie(DEMO_COOKIE_NAME, result.token, {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.max(0, result.expiresAt.getTime() - Date.now()),
    });
    return {
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
      organization: result.organization,
      contributorAlias: result.contributorAlias,
    };
  }

  @Get('status')
  getStatus() {
    return this.demoService.getStatus();
  }

  @Get('counters')
  getCounters() {
    return this.demoService.getCounters();
  }

  @Get('artifacts')
  listArtifacts(@Query('organization') organization?: string) {
    return this.demoService.listPublicArtifacts(organization);
  }

  @Get('workflows')
  listWorkflows(@Query('organization') organization?: string) {
    return this.demoService.listPublicWorkflows(organization);
  }

  @Get('mine/artifacts')
  @UseGuards(DemoAuthGuard)
  mineArtifacts(@Req() request: DemoRequest) {
    return this.demoService.listMine(
      request.user,
      DemoContributionType.ARTIFACT,
    );
  }

  @Get('mine/workflows')
  @UseGuards(DemoAuthGuard)
  mineWorkflows(@Req() request: DemoRequest) {
    return this.demoService.listMine(
      request.user,
      DemoContributionType.WORKFLOW,
    );
  }

  @Get('public/artifacts/:id')
  publicArtifact(@Param('id') id: string) {
    return this.demoService.publicDetail(DemoContributionType.ARTIFACT, id);
  }

  @Get('public/artifacts/:id/history')
  publicArtifactHistory(
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.publicHistory(
      DemoContributionType.ARTIFACT,
      id,
      correlationId,
    );
  }

  @Get('public/workflows/:id')
  publicWorkflow(@Param('id') id: string) {
    return this.demoService.publicDetail(DemoContributionType.WORKFLOW, id);
  }

  @Get('public/workflows/:id/history')
  publicWorkflowHistory(
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.publicHistory(
      DemoContributionType.WORKFLOW,
      id,
      correlationId,
    );
  }

  @Post('session')
  @UseGuards(DemoOriginGuard)
  async createSession(
    @Body() dto: CreateDemoSessionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSessionCookie(
      response,
      await this.demoService.createSession(dto.organization),
    );
  }

  @Post('session/refresh')
  @UseGuards(DemoOriginGuard, DemoAuthGuard, DemoMutationGuard)
  async refreshSession(
    @Req() request: DemoRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSessionCookie(
      response,
      await this.demoService.refreshSession(request.user),
    );
  }

  @Post('artifacts')
  @UseGuards(DemoOriginGuard, DemoAuthGuard, DemoMutationGuard)
  createArtifact(
    @Req() request: DemoRequest,
    @Body() dto: CreateDemoArtifactDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.createArtifact(request.user, dto, correlationId);
  }

  @Get('artifacts/:id')
  @UseGuards(DemoAuthGuard)
  artifact(@Req() request: DemoRequest, @Param('id') id: string) {
    return this.demoService.artifactResponse(id, request.user);
  }

  @Get('artifacts/:id/history')
  @UseGuards(DemoAuthGuard)
  artifactHistory(
    @Req() request: DemoRequest,
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.getArtifactHistory(request.user, id, correlationId);
  }

  @Post('workflows')
  @UseGuards(DemoOriginGuard, DemoAuthGuard, DemoMutationGuard)
  createWorkflow(
    @Req() request: DemoRequest,
    @Body() dto: CreateDemoWorkflowDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.createWorkflow(request.user, dto, correlationId);
  }

  @Get('workflows/:id')
  @UseGuards(DemoAuthGuard)
  workflow(@Req() request: DemoRequest, @Param('id') id: string) {
    return this.demoService.workflowResponse(id, request.user);
  }

  @Get('workflows/:id/history')
  @UseGuards(DemoAuthGuard)
  workflowHistory(
    @Req() request: DemoRequest,
    @Param('id') id: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.demoService.getWorkflowHistory(request.user, id, correlationId);
  }

  @Post('events')
  @UseGuards(DemoOriginGuard, DemoAuthGuard, DemoMutationGuard)
  event(@Req() request: DemoRequest, @Body() dto: CreateDemoEventDto) {
    return this.demoService.recordBrowserEvent(request.user, dto);
  }

  @Post('feedback')
  @UseGuards(DemoOriginGuard, DemoAuthGuard, DemoMutationGuard)
  feedback(@Req() request: DemoRequest, @Body() dto: CreateDemoFeedbackDto) {
    return this.demoService.submitFeedback(request.user, dto);
  }

  @Put('internal/status')
  @UseGuards(DemoControlGuard)
  updateStatus(@Body() dto: UpdateDemoStatusDto) {
    return this.demoService.updateStatus(dto);
  }

  @Get('internal/export')
  @UseGuards(DemoControlGuard)
  exportSanitized() {
    return this.demoService.exportSanitized();
  }

  @Get('internal/metrics')
  @UseGuards(DemoControlGuard)
  operationalMetrics() {
    return this.demoService.getOperationalMetrics();
  }

  @Post('internal/purge')
  @UseGuards(DemoControlGuard)
  purge() {
    return this.demoService.purgeExpired();
  }
}
