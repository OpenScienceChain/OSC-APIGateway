import {
  IsString,
  IsUUID,
  IsEmail,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  ValidateNested,
  Length,
} from 'class-validator';
import { SubmissionState } from '../../artifact/enums/submission-state.enum';
import { GetOrganizationDto } from '../../artifact/dto/get-organization.dto';
import { GitHubRepositoryDto } from './github-repository.dto';
import { Type } from 'class-transformer';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class GetWorkflowArtifactDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;
}

export class GetWorkflowDto {
  @IsUUID()
  id: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsEnum(RecordVisibility)
  visibility: RecordVisibility;

  @IsString()
  @Length(20, 1000)
  submission_comment: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GitHubRepositoryDto)
  githubRepositories: GitHubRepositoryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GetWorkflowArtifactDto)
  artifacts: GetWorkflowArtifactDto[];

  @IsEnum(SubmissionState)
  submissionState: SubmissionState;

  @IsEmail()
  submitterEmail: string;

  @IsString()
  submitterUsername: string;

  @IsDate()
  @IsOptional()
  submittedAt: Date;

  @IsDate()
  @IsOptional()
  updatedAt: Date;

  @IsString()
  @IsOptional()
  blockchainTxId?: string;

  @IsString()
  @IsOptional()
  peerId?: string;

  @IsString()
  @IsOptional()
  submissionError?: string;

  @IsOptional()
  organization: GetOrganizationDto;
}
