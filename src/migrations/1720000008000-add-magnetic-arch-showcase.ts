import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMagneticArchShowcase1720000008000
  implements MigrationInterface
{
  name = 'AddMagneticArchShowcase1720000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "organization_entity"
        ("id", "name", "description", "slug", "mspId", "status")
      VALUES
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
         'Magnetic Arch Plasma Showcase',
         'Curated public provenance example based on the magnetic arch plasma dataset; not operated by the original researchers.',
         'magnetic-arch-plasma-showcase', 'MagneticArchMSP', 'active')
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "organization_entity"
      WHERE "id" = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    `);
  }
}
