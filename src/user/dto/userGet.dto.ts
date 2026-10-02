import { Expose } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class UserGetDto {
  @Expose()
  id: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  name: string;

  @Expose()
  @IsString()
  @IsNotEmpty()
  username: string;

  @Expose()
  roles: string[];

  @Expose()
  organizationName: string;

  @Expose()
  organizationId: string;
}
