import {
  IsString,
  IsUUID,
  IsDate,
  IsOptional,
  IsArray,
  IsEnum,
} from 'class-validator';
import { SubmissionState } from '../../artifact/enums/submission-state.enum';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class ListWorkflowDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  visibility: RecordVisibility;

  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsEnum(SubmissionState)
  submissionState: SubmissionState;

  @IsDate()
  @IsOptional()
  submittedAt: Date;

  @IsDate()
  @IsOptional()
  updatedAt: Date;
}
