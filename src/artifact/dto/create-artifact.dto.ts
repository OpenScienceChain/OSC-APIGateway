import {
  IsNotEmpty,
  IsString,
  IsArray,
  Length,
  IsOptional,
  IsDate,
  IsBoolean,
  IsEnum,
  ValidateNested,
  Matches,
} from 'class-validator';
import { SubmissionState } from '../enums/submission-state.enum';
import { ManifestItem } from '../artifact.entity';
import { Type } from 'class-transformer';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class CreateArtifactDto {
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
  @IsString({ each: true })
  @IsOptional()
  links: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dois: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fundingAgencies: string[];

  @IsString()
  @IsOptional()
  @Length(0, 3000)
  acknowledgements: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManifestItem)
  manifest: ManifestItem[];

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  footprint: string;

  @IsString()
  @IsNotEmpty()
  @Length(20, 1000)
  submission_comment: string;

  @IsDate()
  @IsOptional()
  submittedAt?: Date;

  @IsBoolean()
  @IsOptional()
  verified?: boolean;

  @IsDate()
  @IsOptional()
  lastTimeVerified?: Date;

  @IsEnum(SubmissionState)
  @IsOptional()
  submissionState?: SubmissionState;
}
