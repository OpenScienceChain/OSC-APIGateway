import { DemoOrganizationSlug } from './demo.enums';

export const DEMO_COOKIE_NAME = '__Host-osc_demo';
export const DEMO_SESSION_MINUTES = 30;
export const DEMO_EVENT_ARTIFACT_LIMIT = 1_000;
export const DEMO_EVENT_WORKFLOW_LIMIT = 500;
export const DEMO_SESSION_ARTIFACT_LIMIT = 3;
export const DEMO_SESSION_WORKFLOW_LIMIT = 2;
export const DEMO_FEEDBACK_COMMENT_LIMIT = 300;
export const DEMO_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const DEMO_MAX_FILE_COUNT = 500;
export const DEMO_RETENTION_DAYS = 30;
export const DEMO_SESSION_EVENT_LIMIT = 100;
// Must permit the 1,000-artifact event ceiling to be reachable when each
// anonymous browser session is limited to three artifacts.
export const DEMO_EVENT_SESSION_LIMIT = 1_000;
export const DEMO_RUNTIME_ID = 'usrse26';
export const DEMO_DEFAULT_OPENS_AT = '2026-10-20T15:00:00.000Z';
export const DEMO_DEFAULT_CLOSES_AT = '2026-10-23T15:00:00.000Z';

export const DEMO_ORGANIZATIONS = new Set<string>(
  Object.values(DemoOrganizationSlug),
);

export const DEMO_FILE_EXTENSIONS = new Set([
  'csv',
  'json',
  'md',
  'pdf',
  'png',
  'tif',
  'tiff',
  'txt',
  'yaml',
  'yml',
  'bundle',
]);
