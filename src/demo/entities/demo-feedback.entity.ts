import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('demo_feedback')
export class DemoFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  sessionHash: string;

  @Column('uuid')
  organizationId: string;

  @Column({ type: 'smallint' })
  easeRating: number;

  @Column({ type: 'smallint' })
  provenanceRating: number;

  @Column({ type: 'smallint' })
  usefulnessRating: number;

  @Column({ type: 'text', nullable: true })
  privateComment: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  submittedAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  retentionExpiresAt: Date;
}
