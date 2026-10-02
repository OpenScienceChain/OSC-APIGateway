import { IsEnum } from 'class-validator';
import { DemoOrganizationSlug } from '../demo.enums';

export class CreateDemoSessionDto {
  @IsEnum(DemoOrganizationSlug)
  organization: DemoOrganizationSlug;
}
