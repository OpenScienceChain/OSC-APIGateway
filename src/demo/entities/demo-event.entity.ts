import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DemoEventName } from '../demo.enums';

@Entity('demo_event')
export class DemoEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 64 })
  sessionHash: string;

  @Column('uuid')
  organizationId: string;

  @Column({ type: 'text' })
  eventName: DemoEventName;

  @Column({ nullable: true, length: 20 })
  resourceType: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  occurredAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  retentionExpiresAt: Date;
}
