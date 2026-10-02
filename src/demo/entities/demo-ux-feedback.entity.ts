import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('demo_ux_feedback')
export class DemoUxFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'smallint', nullable: true })
  visualRating: number | null;

  @Column({ length: 8, nullable: true })
  automationInterest: string | null;

  @Column({ type: 'text', nullable: true })
  overallComment: string | null;

  @Column({ length: 12 })
  phase: string;

  @Column({ nullable: true, length: 64 })
  runId: string | null;

  @Index()
  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  submittedAt: Date;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  retentionExpiresAt: Date;
}
