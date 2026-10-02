import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDemoUxFeedbackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  visualRating?: number;

  @IsOptional()
  @IsIn(['YES', 'MAYBE', 'NO', 'UNSURE'])
  automationInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  overallComment?: string;
}
