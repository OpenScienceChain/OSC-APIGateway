import { IsIn } from 'class-validator';

export const UX_EVENT_TYPES = [
  'PAGE_VIEW',
  'CATALOG_SEARCH',
  'CATALOG_FILTER',
  'RECORD_VIEW',
  'HISTORY_VIEW',
  'CONTRIBUTE_CLICK',
  'FORM_START',
  'VALIDATION_ERROR',
  'SUBMISSION_ATTEMPT',
  'ARTIFACT_SUBMITTED',
  'WORKFLOW_SUBMITTED',
  'AUTH_ACTION',
] as const;

export const UX_ROUTES = [
  '/',
  '/feedback',
  '/interactive-demo',
  '/research-example',
  '/list-artifacts',
  '/list-workflows',
  '/contribute',
  '/create-workflow',
  '/auth/sign-in',
  '/auth/team-sign-in',
  '/artifacts/:id',
  '/artifacts/:id/history',
  '/artifacts/:id/history/:txId',
  '/update-artifact/:id',
  '/workflows/:id',
  '/workflows/:id/history',
  '/update-workflow/:id',
] as const;

export const UX_DEVICE_CATEGORIES = [
  'DESKTOP',
  'TABLET',
  'MOBILE',
  'SMALL_MOBILE',
] as const;

export class CreateDemoUxEventDto {
  @IsIn(UX_EVENT_TYPES)
  eventType: string;

  @IsIn(UX_ROUTES)
  route: string;

  @IsIn(UX_DEVICE_CATEGORIES)
  deviceCategory: string;
}
