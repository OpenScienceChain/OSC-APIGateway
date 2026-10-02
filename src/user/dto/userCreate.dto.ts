import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Role } from '../../shared/enums/role.enums';

export class UserCreateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsEnum(Role, {
    message: 'Invalid role. Must be one of: ADMIN, PI, COLLABORATOR',
  })
  @IsNotEmpty()
  role: Role;

  @IsUUID('4')
  @IsOptional()
  organizationId?: string;
}
