import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Role } from '../shared/enums/role.enums';
import { MembershipStatus } from './membership-status.enum';

export class CreateOrganizationMembershipDto {
  @IsUUID('4')
  userId: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles: Role[];
}

export class UpdateOrganizationMembershipDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
