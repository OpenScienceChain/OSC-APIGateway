import { IsEnum, IsIn } from 'class-validator';
import { DemoEventName } from '../demo.enums';

const BROWSER_EVENT_NAMES = [
  DemoEventName.STATUS_VIEWED,
  DemoEventName.SURVEY_SHOWN,
] as const;

export class CreateDemoEventDto {
  @IsEnum(DemoEventName)
  @IsIn(BROWSER_EVENT_NAMES)
  eventName: DemoEventName;
}
