import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateMessageOutbox1720000001000 implements MigrationInterface {
  name = 'CreateMessageOutbox1720000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('message_outbox')) return;

    await queryRunner.createTable(
      new Table({
        name: 'message_outbox',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            isGenerated: true,
          },
          { name: 'routingKey', type: 'varchar' },
          { name: 'aggregateId', type: 'varchar' },
          { name: 'messageId', type: 'varchar' },
          { name: 'payload', type: 'jsonb' },
          { name: 'status', type: 'text', default: "'pending'" },
          { name: 'attempts', type: 'integer', default: 0 },
          {
            name: 'availableAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          { name: 'publishedAt', type: 'timestamp', isNullable: true },
          { name: 'lastError', type: 'text', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'message_outbox',
      new TableIndex({
        name: 'IDX_message_outbox_status_available',
        columnNames: ['status', 'availableAt'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('message_outbox')) {
      await queryRunner.dropTable('message_outbox');
    }
  }
}
