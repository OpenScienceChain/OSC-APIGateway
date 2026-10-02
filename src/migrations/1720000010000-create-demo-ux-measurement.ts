import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDemoUxMeasurement1720000010000
  implements MigrationInterface
{
  name = 'CreateDemoUxMeasurement1720000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "demo_ux_browser" (
        "browserHash" varchar(64) PRIMARY KEY,
        "consentedAt" timestamp NOT NULL,
        "expiresAt" timestamp NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "demo_ux_event" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "browserHash" varchar(64) NOT NULL,
        "eventType" varchar(32) NOT NULL,
        "route" varchar(64) NOT NULL,
        "deviceCategory" varchar(16) NOT NULL,
        "phase" varchar(12) NOT NULL,
        "runId" varchar(64),
        "occurredAt" timestamp NOT NULL,
        "retentionExpiresAt" timestamp NOT NULL,
        CONSTRAINT "FK_demo_ux_event_browser" FOREIGN KEY ("browserHash") REFERENCES "demo_ux_browser" ("browserHash") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_demo_ux_event_browser" ON "demo_ux_event" ("browserHash")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_demo_ux_event_occurred" ON "demo_ux_event" ("occurredAt")',
    );
    await queryRunner.query(`
      CREATE TABLE "demo_ux_counter" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventType" varchar(24) NOT NULL,
        "phase" varchar(12) NOT NULL,
        "runId" varchar(64),
        "occurredAt" timestamp NOT NULL,
        "retentionExpiresAt" timestamp NOT NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_demo_ux_counter_occurred" ON "demo_ux_counter" ("occurredAt")',
    );
    await queryRunner.query(`
      CREATE TABLE "demo_ux_feedback" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "visualRating" smallint,
        "automationInterest" varchar(8),
        "overallComment" text,
        "phase" varchar(12) NOT NULL,
        "runId" varchar(64),
        "submittedAt" timestamp NOT NULL,
        "retentionExpiresAt" timestamp NOT NULL,
        CONSTRAINT "CHK_demo_ux_visual_rating" CHECK ("visualRating" IS NULL OR "visualRating" BETWEEN 1 AND 5),
        CONSTRAINT "CHK_demo_ux_automation_interest" CHECK ("automationInterest" IS NULL OR "automationInterest" IN ('YES', 'MAYBE', 'NO', 'UNSURE'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_demo_ux_feedback_submitted" ON "demo_ux_feedback" ("submittedAt")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "demo_ux_feedback"');
    await queryRunner.query('DROP TABLE "demo_ux_counter"');
    await queryRunner.query('DROP TABLE "demo_ux_event"');
    await queryRunner.query('DROP TABLE "demo_ux_browser"');
  }
}
