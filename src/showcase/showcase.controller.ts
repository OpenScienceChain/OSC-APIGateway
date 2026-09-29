import { Controller, Get, Param } from '@nestjs/common';
import { ShowcaseService } from './showcase.service';

@Controller('showcase')
export class ShowcaseController {
  constructor(private readonly showcase: ShowcaseService) {}

  @Get()
  list() {
    return this.showcase.list();
  }

  @Get('artifacts/:id')
  artifact(@Param('id') id: string) {
    return this.showcase.artifact(id);
  }

  @Get('artifacts/:id/history')
  artifactHistory(@Param('id') id: string) {
    return this.showcase.history('artifact', id);
  }

  @Get('workflows/:id')
  workflow(@Param('id') id: string) {
    return this.showcase.workflow(id);
  }

  @Get('workflows/:id/history')
  workflowHistory(@Param('id') id: string) {
    return this.showcase.history('workflow', id);
  }
}
