import { IsEnum, IsString, Matches } from 'class-validator';
import { DemoOrganizationSlug } from '../demo.enums';

export class DemoAccountCredentialsDto {
  @IsEnum(DemoOrganizationSlug)
  organization: DemoOrganizationSlug;

  @IsString()
  @Matches(/^[a-zA-Z][a-zA-Z0-9_-]{2,23}$/)
  username: string;

  @IsString()
  @Matches(/^\d{4,6}$/)
  pin: string;
}
