import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseDemoFileLimits1720000009000 implements MigrationInterface {
  name = 'IncreaseDemoFileLimits1720000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "demo_contribution"
      DROP CONSTRAINT "CHK_demo_contribution_file"
    `);
    await queryRunner.query(`
      ALTER TABLE "demo_contribution"
      ADD CONSTRAINT "CHK_demo_contribution_file"
      CHECK ("sizeBytes" IS NULL OR "sizeBytes" BETWEEN 1 AND 52428800)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "demo_contribution"
      DROP CONSTRAINT "CHK_demo_contribution_file"
    `);
    await queryRunner.query(`
      ALTER TABLE "demo_contribution"
      ADD CONSTRAINT "CHK_demo_contribution_file"
      CHECK ("sizeBytes" IS NULL OR "sizeBytes" BETWEEN 1 AND 10485760)
    `);
  }
}
