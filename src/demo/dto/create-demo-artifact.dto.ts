import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DEMO_MAX_FILE_BYTES } from '../demo.constants';
import { DemoResearchContext } from '../demo.enums';
import { DemoFileEntryDto } from './demo-file-entry.dto';

export class CreateDemoArtifactDto {
  @IsUUID('4')
  requestId: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  fingerprint: string;

  @IsInt()
  @Min(1)
  @Max(DEMO_MAX_FILE_BYTES)
  sizeBytes: number;

  @IsString()
  @Matches(/^[a-z0-9]{1,12}$/)
  extension: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DemoFileEntryDto)
  files?: DemoFileEntryDto[];

  @IsEnum(DemoResearchContext)
  researchContext: DemoResearchContext;

  @IsString()
  @Length(3, 200)
  title: string;

  @IsString()
  @Length(50, 3000)
  description: string;

  @IsString()
  @Length(20, 1000)
  submissionComment: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @MaxLength(400, { each: true })
  links?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(/^10\.\d{4,9}\/[-_.;()/:A-Za-z0-9]+$/, { each: true })
  dois?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  fundingAgencies?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  acknowledgements?: string;
}
