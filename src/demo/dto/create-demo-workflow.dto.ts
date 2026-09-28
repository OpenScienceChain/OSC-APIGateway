import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DemoResearchContext } from '../demo.enums';

class DemoRepositoryContentDto {
  @IsString()
  @Length(1, 160)
  filename: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hash?: string;
}

class DemoGitHubRepositoryDto {
  @IsString()
  @MaxLength(400)
  @Matches(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{7,40}$/)
  gitHash?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DemoRepositoryContentDto)
  contents?: DemoRepositoryContentDto[];
}

export class CreateDemoWorkflowDto {
  @IsUUID('4')
  requestId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  artifactIds: string[];

  @IsEnum(DemoResearchContext)
  researchContext: DemoResearchContext;

  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(50, 3000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(20, 1000)
  submissionComment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => DemoGitHubRepositoryDto)
  githubRepositories?: DemoGitHubRepositoryDto[];
}
