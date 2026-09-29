import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDemoAccounts1720000007000 implements MigrationInterface {
  name = 'AddDemoAccounts1720000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "demo_account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organizationId" uuid NOT NULL,
        "organizationSlug" character varying(80) NOT NULL,
        "username" character varying(24) NOT NULL,
        "pinHash" character varying(72) NOT NULL,
        "failedAttempts" integer NOT NULL DEFAULT 0,
        "artifactCount" integer NOT NULL DEFAULT 0,
        "workflowCount" integer NOT NULL DEFAULT 0,
        "lockedUntil" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_account" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_account_org_username" UNIQUE ("organizationId", "username"),
        CONSTRAINT "FK_demo_account_organization" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_demo_account_attempts" CHECK ("failedAttempts" BETWEEN 0 AND 5),
        CONSTRAINT "CHK_demo_account_counts" CHECK ("artifactCount" BETWEEN 0 AND 3 AND "workflowCount" BETWEEN 0 AND 2)
      )
    `);
    await queryRunner.query('ALTER TABLE "demo_session" ADD "accountId" uuid');
    await queryRunner.query(
      'ALTER TABLE "demo_session" ADD CONSTRAINT "FK_demo_session_account" FOREIGN KEY ("accountId") REFERENCES "demo_account"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_demo_session_account" ON "demo_session" ("accountId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_demo_session_account"');
    await queryRunner.query(
      'ALTER TABLE "demo_session" DROP CONSTRAINT "FK_demo_session_account"',
    );
    await queryRunner.query(
      'ALTER TABLE "demo_session" DROP COLUMN "accountId"',
    );
    await queryRunner.query('DROP TABLE "demo_account"');
  }
}
