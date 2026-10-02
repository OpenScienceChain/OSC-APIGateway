import { ManifestItem } from '../artifact.entity';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

// DTO for PI / Collaborator updates: all fields optional except title/description are disallowed
export class UpdateArtifactUserDto {
  @IsString()
  @IsNotEmpty()
  @Length(20, 1000)
  submission_comment: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  links?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dois?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fundingAgencies?: string[];

  @IsString()
  @IsOptional()
  acknowledgements?: string;

  @IsOptional()
  manifest?: ManifestItem[];

  @IsString()
  @IsOptional()
  footprint?: string;
}
