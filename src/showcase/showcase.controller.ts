import { Controller, Get, Param } from '@nestjs/common';
import { ShowcaseService } from './showcase.service';

@Controller('showcase')
export class ShowcaseController {
  constructor(private readonly showcase: ShowcaseService) {}

  @Get()
  list() {
    return this.showcase.list();
  }

  @Get('examples')
  examples() {
    return this.showcase.examples();
  }

  @Get('examples/:key/artifacts/:id')
  exampleArtifact(@Param('key') key: string, @Param('id') id: string) {
    return this.showcase.exampleArtifact(key, id);
  }

  @Get('examples/:key/workflows/:id')
  exampleWorkflow(@Param('key') key: string, @Param('id') id: string) {
    return this.showcase.exampleWorkflow(key, id);
  }

  @Get('examples/:key/artifacts/:id/history')
  exampleArtifactHistory(@Param('key') key: string, @Param('id') id: string) {
    return this.showcase.exampleHistory(key, 'artifact', id);
  }

  @Get('examples/:key/workflows/:id/history')
  exampleWorkflowHistory(@Param('key') key: string, @Param('id') id: string) {
    return this.showcase.exampleHistory(key, 'workflow', id);
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
