import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { DemoLifecycleState } from '../demo.enums';

export class UpdateDemoStatusDto {
  @IsEnum(DemoLifecycleState)
  state: DemoLifecycleState;

  @IsString()
  @Length(1, 128)
  @Matches(/^[A-Za-z0-9._-]+$/)
  runId: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  closesAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  opensAt?: string;
}
