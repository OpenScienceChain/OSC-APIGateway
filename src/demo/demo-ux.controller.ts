import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CreateDemoUxEventDto } from './dto/create-demo-ux-event.dto';
import { CreateDemoUxFeedbackDto } from './dto/create-demo-ux-feedback.dto';
import { DemoUxService } from './demo-ux.service';
import { DemoControlGuard } from './guards/demo-control.guard';
import { DemoOriginGuard } from './guards/demo-origin.guard';

@Controller('demo')
export class DemoUxController {
  constructor(private readonly ux: DemoUxService) {}

  @Post('analytics/session')
  @UseGuards(DemoOriginGuard)
  consent(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ux.consent(request, response);
  }

  @Post('analytics/reject')
  @UseGuards(DemoOriginGuard)
  reject() {
    return this.ux.reject();
  }

  @Post('analytics/events')
  @UseGuards(DemoOriginGuard)
  event(@Req() request: Request, @Body() dto: CreateDemoUxEventDto) {
    return this.ux.recordEvent(request, dto);
  }

  @Delete('analytics/session')
  @UseGuards(DemoOriginGuard)
  revoke(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.ux.revoke(request, response);
  }

  @Post('ux-feedback/view')
  @UseGuards(DemoOriginGuard)
  surveyOpen() {
    return this.ux.surveyOpen();
  }

  @Post('ux-feedback')
  @UseGuards(DemoOriginGuard)
  survey(@Body() dto: CreateDemoUxFeedbackDto) {
    return this.ux.submitSurvey(dto);
  }

  @Get('internal/ux-metrics')
  @UseGuards(DemoControlGuard)
  metrics() {
    return this.ux.metrics();
  }

  @Get('internal/ux-feedback/comments')
  @UseGuards(DemoControlGuard)
  comments() {
    return this.ux.comments();
  }

  @Post('internal/ux-purge')
  @UseGuards(DemoControlGuard)
  purge() {
    return this.ux.purgeExpired();
  }
}
