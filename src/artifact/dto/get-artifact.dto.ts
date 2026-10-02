import {
  IsString,
  IsUUID,
  IsEmail,
  IsArray,
  IsUrl,
  IsDate,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsObject,
  ValidateNested,
  Matches,
  Length,
} from 'class-validator';
import { SubmissionState } from '../enums/submission-state.enum';
import { GetOrganizationDto } from './get-organization.dto';
import { ManifestItem } from '../artifact.entity';
import { Type } from 'class-transformer';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class GetArtifactDto {
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

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  footprint: string;

  @IsArray()
  @IsUrl({}, { each: true })
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
  acknowledgements: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManifestItem)
  manifest: ManifestItem[];

  @IsBoolean()
  verified: boolean;

  // lastTimeVerified removed from API response

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

  @IsObject()
  @IsOptional()
  submitter?: {
    id: string;
    name: string;
    username: string;
  };
}
