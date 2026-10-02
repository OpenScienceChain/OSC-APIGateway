import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddArtifactArchival1720000004000 implements MigrationInterface {
  name = 'AddArtifactArchival1720000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "artifact_entity" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "artifact_entity" DROP COLUMN IF EXISTS "archivedAt"',
    );
  }
}
