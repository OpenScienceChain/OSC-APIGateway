import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OutboxStatus {
  PENDING = 'pending',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

@Entity('message_outbox')
@Index(['status', 'availableAt'])
export class OutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  routingKey: string;

  @Column()
  aggregateId: string;

  @Column()
  messageId: string;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'simple-json' : 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text', default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ default: 0 })
  attempts: number;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  availableAt: Date;

  @CreateDateColumn({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  createdAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  publishedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;
}
