import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordVisibility1720000003000 implements MigrationInterface {
  name = 'AddRecordVisibility1720000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['artifact_entity', 'workflow_entity']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public'`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "visibility" SET DEFAULT 'private'`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_visibility" CHECK ("visibility" IN ('public', 'private'))`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['workflow_entity', 'artifact_entity']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CHK_${table}_visibility"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "visibility"`,
      );
    }
  }
}
