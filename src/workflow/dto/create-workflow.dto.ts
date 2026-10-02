import {
  IsNotEmpty,
  IsString,
  IsArray,
  Length,
  IsOptional,
  ValidateNested,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GitHubRepositoryDto } from './github-repository.dto';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @Length(50, 3000)
  description: string;

  @IsEnum(RecordVisibility)
  @IsOptional()
  visibility?: RecordVisibility;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GitHubRepositoryDto)
  @IsOptional()
  githubRepositories: GitHubRepositoryDto[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  artifactIds: string[];

  @IsString()
  @IsNotEmpty()
  @Length(20, 1000)
  submission_comment: string;
}
