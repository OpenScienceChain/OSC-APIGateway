import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsrse26Demo1720000005000 implements MigrationInterface {
  name = 'CreateUsrse26Demo1720000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "demo_runtime" (
        "id" character varying(40) NOT NULL,
        "state" text NOT NULL DEFAULT 'SCHEDULED',
        "runId" character varying(128),
        "reason" character varying(300),
        "opensAt" TIMESTAMP NOT NULL,
        "closesAt" TIMESTAMP NOT NULL,
        "artifactReservations" integer NOT NULL DEFAULT 0,
        "workflowReservations" integer NOT NULL DEFAULT 0,
        "sessionReservations" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_runtime" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_demo_runtime_state" CHECK ("state" IN ('SCHEDULED', 'PREPARING', 'OPEN', 'READ_ONLY', 'CLOSED')),
        CONSTRAINT "CHK_demo_runtime_counts" CHECK ("artifactReservations" >= 0 AND "workflowReservations" >= 0 AND "sessionReservations" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "demo_session" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionHash" character varying(64) NOT NULL,
        "organizationId" uuid NOT NULL,
        "organizationSlug" character varying(80) NOT NULL,
        "contributorAlias" character varying(40) NOT NULL,
        "csrfHash" character varying(64) NOT NULL,
        "artifactCount" integer NOT NULL DEFAULT 0,
        "workflowCount" integer NOT NULL DEFAULT 0,
        "feedbackSubmitted" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "absoluteCloseAt" TIMESTAMP NOT NULL,
        "retentionExpiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_session" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_session_hash" UNIQUE ("sessionHash"),
        CONSTRAINT "FK_demo_session_organization" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_demo_session_org" CHECK ("organizationSlug" IN ('neuroscience-gateway', 'citizen-science')),
        CONSTRAINT "CHK_demo_session_counts" CHECK ("artifactCount" BETWEEN 0 AND 3 AND "workflowCount" BETWEEN 0 AND 2)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "demo_contribution" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recordType" text NOT NULL,
        "recordId" uuid NOT NULL,
        "requestId" uuid NOT NULL,
        "sessionHash" character varying(64) NOT NULL,
        "organizationId" uuid NOT NULL,
        "sizeBytes" integer,
        "extension" character varying(12),
        "fingerprint" character varying(64),
        "researchContext" character varying(40),
        "artifactIds" jsonb,
        "acceptedAt" TIMESTAMP NOT NULL,
        "retentionExpiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_contribution" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_contribution_record" UNIQUE ("recordType", "recordId"),
        CONSTRAINT "UQ_demo_contribution_request" UNIQUE ("sessionHash", "requestId"),
        CONSTRAINT "FK_demo_contribution_organization" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_demo_contribution_type" CHECK ("recordType" IN ('ARTIFACT', 'WORKFLOW')),
        CONSTRAINT "CHK_demo_contribution_file" CHECK ("sizeBytes" IS NULL OR "sizeBytes" BETWEEN 1 AND 10485760)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "demo_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionHash" character varying(64) NOT NULL,
        "organizationId" uuid NOT NULL,
        "eventName" text NOT NULL,
        "resourceType" character varying(20),
        "occurredAt" TIMESTAMP NOT NULL,
        "retentionExpiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_demo_event_organization" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_demo_event_name" CHECK ("eventName" IN ('SESSION_STARTED', 'STATUS_VIEWED', 'HISTORY_VIEWED', 'SURVEY_SHOWN', 'ARTIFACT_ACCEPTED', 'WORKFLOW_ACCEPTED'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_demo_event_session" ON "demo_event" ("sessionHash")',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "demo_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sessionHash" character varying(64) NOT NULL,
        "organizationId" uuid NOT NULL,
        "easeRating" smallint NOT NULL,
        "provenanceRating" smallint NOT NULL,
        "usefulnessRating" smallint NOT NULL,
        "privateComment" text,
        "submittedAt" TIMESTAMP NOT NULL,
        "retentionExpiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_feedback_session" UNIQUE ("sessionHash"),
        CONSTRAINT "FK_demo_feedback_organization" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_demo_feedback_ratings" CHECK ("easeRating" BETWEEN 1 AND 5 AND "provenanceRating" BETWEEN 1 AND 5 AND "usefulnessRating" BETWEEN 1 AND 5)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "demo_feedback"');
    await queryRunner.query('DROP TABLE IF EXISTS "demo_event"');
    await queryRunner.query('DROP TABLE IF EXISTS "demo_contribution"');
    await queryRunner.query('DROP TABLE IF EXISTS "demo_session"');
    await queryRunner.query('DROP TABLE IF EXISTS "demo_runtime"');
  }
}
