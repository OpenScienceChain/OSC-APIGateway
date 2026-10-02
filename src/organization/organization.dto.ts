import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { MembershipStatus, OrganizationStatus } from './membership-status.enum';

export class OrganizationDto {
  @IsString()
  @IsNotEmpty()
  readonly name: string;

  @IsString()
  @IsNotEmpty()
  readonly description: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  readonly slug?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9]*MSP$/)
  readonly mspId?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]+$/)
  readonly ledgerGroupName?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z0-9.@_-]+$/)
  readonly ledgerApiUserId?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]+$/)
  readonly artifactSchemaName?: string;
}

export class UserForOrganizationDto {
  id: string;
  name: string;
  username: string;
  email: string;
  roles: string[];
  membershipId?: string;
  membershipStatus?: MembershipStatus;
}

export class OrganizationResponseDto {
  id: string;
  name: string;
  description: string;
  slug?: string;
  mspId?: string;
  status: OrganizationStatus;
  archivedAt?: Date | null;
  ledgerGroupName?: string;
  ledgerApiUserId?: string;
  artifactSchemaName?: string;
  users: UserForOrganizationDto[];
  artifacts: any[];
}
