import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOrganizationLedgerRouting1720000000000
  implements MigrationInterface
{
  name = 'AddOrganizationLedgerRouting1720000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = 'organization_entity';
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    const columns = [
      new TableColumn({
        name: 'ledgerGroupName',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'ledgerApiUserId',
        type: 'varchar',
        isNullable: true,
      }),
      new TableColumn({
        name: 'artifactSchemaName',
        type: 'varchar',
        isNullable: true,
      }),
    ];

    for (const column of columns) {
      if (!(await queryRunner.hasColumn(tableName, column.name))) {
        await queryRunner.addColumn(tableName, column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = 'organization_entity';
    if (!(await queryRunner.hasTable(tableName))) {
      return;
    }

    for (const columnName of [
      'artifactSchemaName',
      'ledgerApiUserId',
      'ledgerGroupName',
    ]) {
      if (await queryRunner.hasColumn(tableName, columnName)) {
        await queryRunner.dropColumn(tableName, columnName);
      }
    }
  }
}
