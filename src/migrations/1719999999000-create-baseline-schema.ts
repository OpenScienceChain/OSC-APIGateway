import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reconstructs the schema that predates the checked-in incremental migrations.
 * Existing installations are unchanged because every object is created only
 * when absent; new environments can now start from an empty PostgreSQL database.
 */
export class CreateBaselineSchema1719999999000 implements MigrationInterface {
  name = 'CreateBaselineSchema1719999999000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_entity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "description" character varying NOT NULL,
        CONSTRAINT "PK_organization_entity" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_entity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "username" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "roles" text NOT NULL,
        "organizationId" uuid,
        CONSTRAINT "PK_user_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_entity_username" UNIQUE ("username"),
        CONSTRAINT "UQ_user_entity_email" UNIQUE ("email"),
        CONSTRAINT "FK_user_entity_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organization_entity"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "artifact_entity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying NOT NULL,
        "description" character varying NOT NULL,
        "keywords" text NOT NULL,
        "links" text NOT NULL,
        "dois" text NOT NULL,
        "fundingAgencies" text NOT NULL,
        "acknowledgements" text NOT NULL,
        "manifest" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "footprint" character varying NOT NULL,
        "verified" boolean NOT NULL DEFAULT false,
        "lastTimeVerified" TIMESTAMP,
        "submissionState" text NOT NULL DEFAULT 'pending',
        "submitterEmail" character varying NOT NULL,
        "submitterUsername" character varying NOT NULL,
        "submission_comment" character varying NOT NULL,
        "submittedAt" TIMESTAMP,
        "updatedAt" TIMESTAMP,
        "blockchainTxId" character varying,
        "peerId" character varying,
        "submissionError" text,
        "organizationId" uuid NOT NULL,
        CONSTRAINT "PK_artifact_entity" PRIMARY KEY ("id"),
        CONSTRAINT "FK_artifact_entity_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organization_entity"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_entity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying NOT NULL,
        "description" character varying NOT NULL,
        "keywords" text,
        "githubRepositories" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "submitterEmail" character varying NOT NULL,
        "submitterUsername" character varying NOT NULL,
        "submission_comment" character varying NOT NULL,
        "submissionState" text NOT NULL DEFAULT 'pending',
        "submittedAt" TIMESTAMP,
        "updatedAt" TIMESTAMP,
        "blockchainTxId" character varying,
        "peerId" character varying,
        "submissionError" text,
        "organizationId" uuid NOT NULL,
        CONSTRAINT "PK_workflow_entity" PRIMARY KEY ("id"),
        CONSTRAINT "FK_workflow_entity_organization" FOREIGN KEY ("organizationId")
          REFERENCES "organization_entity"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_artifacts" (
        "workflowEntityId" uuid NOT NULL,
        "artifactEntityId" uuid NOT NULL,
        CONSTRAINT "PK_workflow_artifacts" PRIMARY KEY ("workflowEntityId", "artifactEntityId"),
        CONSTRAINT "FK_workflow_artifacts_workflow" FOREIGN KEY ("workflowEntityId")
          REFERENCES "workflow_entity"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_workflow_artifacts_artifact" FOREIGN KEY ("artifactEntityId")
          REFERENCES "artifact_entity"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_workflow_artifacts_workflow" ON "workflow_artifacts" ("workflowEntityId")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_workflow_artifacts_artifact" ON "workflow_artifacts" ("artifactEntityId")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_artifacts"');
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_entity"');
    await queryRunner.query('DROP TABLE IF EXISTS "artifact_entity"');
    await queryRunner.query('DROP TABLE IF EXISTS "user_entity"');
    await queryRunner.query('DROP TABLE IF EXISTS "organization_entity"');
  }
}
