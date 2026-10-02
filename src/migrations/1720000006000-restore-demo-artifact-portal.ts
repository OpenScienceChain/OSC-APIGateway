import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestoreDemoArtifactPortal1720000006000
  implements MigrationInterface
{
  name = 'RestoreDemoArtifactPortal1720000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "demo_contribution" ADD COLUMN "createPayloadHash" character varying(64)',
    );
    await queryRunner.query(`
      CREATE TABLE "demo_artifact_edit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recordId" uuid NOT NULL,
        "requestId" uuid NOT NULL,
        "sessionHash" character varying(64) NOT NULL,
        "payloadHash" character varying(64) NOT NULL,
        "editNumber" integer NOT NULL,
        "baselineTxId" character varying,
        "reservedAt" TIMESTAMP NOT NULL,
        "queuedAt" TIMESTAMP,
        "retentionExpiresAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_demo_artifact_edit" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_demo_artifact_edit_request" UNIQUE ("recordId", "requestId"),
        CONSTRAINT "UQ_demo_artifact_edit_number" UNIQUE ("recordId", "editNumber"),
        CONSTRAINT "CHK_demo_artifact_edit_number" CHECK ("editNumber" BETWEEN 1 AND 2)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "demo_artifact_edit"');
    await queryRunner.query(
      'ALTER TABLE "demo_contribution" DROP COLUMN "createPayloadHash"',
    );
  }
}
