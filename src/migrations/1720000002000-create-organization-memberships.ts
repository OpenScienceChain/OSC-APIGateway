import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationMemberships1720000002000
  implements MigrationInterface
{
  name = 'CreateOrganizationMemberships1720000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "user_entity" ADD COLUMN IF NOT EXISTS "platformAdmin" boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      'ALTER TABLE "user_entity" ADD COLUMN IF NOT EXISTS "authVersion" integer NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" ADD COLUMN IF NOT EXISTS "slug" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" ADD COLUMN IF NOT EXISTS "mspId" character varying',
    );
    await queryRunner.query(
      `ALTER TABLE "organization_entity" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active'`,
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_slug" ON "organization_entity" ("slug") WHERE "slug" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_msp" ON "organization_entity" ("mspId") WHERE "mspId" IS NOT NULL',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_membership" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "roles" text NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deactivatedAt" TIMESTAMP,
        "userId" uuid NOT NULL,
        "organizationId" uuid NOT NULL,
        CONSTRAINT "PK_organization_membership" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organization_membership_user_org" UNIQUE ("userId", "organizationId"),
        CONSTRAINT "FK_organization_membership_user" FOREIGN KEY ("userId") REFERENCES "user_entity"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_membership_org" FOREIGN KEY ("organizationId") REFERENCES "organization_entity"("id") ON DELETE RESTRICT
      )
    `);

    // Convert the legacy one-organization assignment into an active membership.
    await queryRunner.query(`
      INSERT INTO "organization_membership" ("roles", "status", "userId", "organizationId")
      SELECT u."roles", 'active', u."id", u."organizationId"
      FROM "user_entity" u
      WHERE u."organizationId" IS NOT NULL
      ON CONFLICT ("userId", "organizationId") DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE "user_entity"
      SET "platformAdmin" = true
      WHERE "organizationId" IS NULL AND position('admin' in "roles") > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "organization_membership"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_organization_msp"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_organization_slug"');
    await queryRunner.query(
      'ALTER TABLE "organization_entity" DROP COLUMN IF EXISTS "archivedAt"',
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" DROP COLUMN IF EXISTS "status"',
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" DROP COLUMN IF EXISTS "mspId"',
    );
    await queryRunner.query(
      'ALTER TABLE "organization_entity" DROP COLUMN IF EXISTS "slug"',
    );
    await queryRunner.query(
      'ALTER TABLE "user_entity" DROP COLUMN IF EXISTS "authVersion"',
    );
    await queryRunner.query(
      'ALTER TABLE "user_entity" DROP COLUMN IF EXISTS "platformAdmin"',
    );
  }
}
