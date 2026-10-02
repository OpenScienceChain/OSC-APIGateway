import { IsInt, Matches, Max, Min } from 'class-validator';
import { DEMO_MAX_FILE_BYTES } from '../demo.constants';

export class DemoFileEntryDto {
  @Matches(/^[a-f0-9]{64}$/)
  hash: string;

  @IsInt()
  @Min(1)
  @Max(DEMO_MAX_FILE_BYTES)
  sizeBytes: number;

  @Matches(/^[a-z0-9]{1,12}$/)
  extension: string;
}
