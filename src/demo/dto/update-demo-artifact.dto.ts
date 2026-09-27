import {
  ArrayMaxSize,
  IsArray,
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
} from 'class-validator';
import { DEMO_MAX_FILE_BYTES } from '../demo.constants';

export class UpdateDemoArtifactDto {
  @IsUUID('4')
  requestId: string;

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

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  fingerprint?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(DEMO_MAX_FILE_BYTES)
  sizeBytes?: number;

  @IsOptional()
  @Matches(/^[a-z0-9]{1,12}$/)
  extension?: string;
}
