import {
  IsString,
  IsUUID,
  IsDate,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { RecordVisibility } from '../../shared/enums/record-visibility.enum';

export class ListArtifactDto {
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

  @IsString()
  footprint: string;

  @IsDate()
  @IsOptional()
  submittedAt: Date;

  @IsBoolean()
  verified: boolean;

  // lastTimeVerified removed from list response

  @IsDate()
  @IsOptional()
  updatedAt: Date;
}
