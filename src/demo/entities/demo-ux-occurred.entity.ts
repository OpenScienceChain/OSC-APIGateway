import { Column, Index } from 'typeorm';

export abstract class DemoUxOccurredEntity {
  @Column({ length: 12 })
  phase: string;

  @Column({ nullable: true, length: 64 })
  runId: string | null;

  @Index()
  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  occurredAt: Date;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  retentionExpiresAt: Date;
}
