import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { DEMO_FEEDBACK_COMMENT_LIMIT } from '../demo.constants';

export class CreateDemoFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  easeRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  provenanceRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  usefulnessRating: number;

  @IsOptional()
  @IsString()
  @Length(0, DEMO_FEEDBACK_COMMENT_LIMIT)
  comment?: string;
}
