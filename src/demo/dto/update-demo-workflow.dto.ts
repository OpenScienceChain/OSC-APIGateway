import { PickType } from '@nestjs/mapped-types';
import { IsString, IsUUID, Length } from 'class-validator';
import { CreateDemoWorkflowDto } from './create-demo-workflow.dto';

export class UpdateDemoWorkflowDto extends PickType(CreateDemoWorkflowDto, [
  'artifactIds',
  'keywords',
  'githubRepositories',
]) {
  @IsUUID('4')
  requestId: string;

  @IsString()
  @Length(20, 1000)
  submissionComment: string;
}
