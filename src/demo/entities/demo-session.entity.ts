import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('demo_session')
export class DemoSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  sessionHash: string;

  @Column('uuid')
  organizationId: string;

  @Column({ length: 80 })
  organizationSlug: string;

  @Column({ length: 40 })
  contributorAlias: string;

  @Column('uuid', { nullable: true })
  accountId: string | null;

  @Column({ length: 64 })
  csrfHash: string;

  @Column({ default: 0 })
  artifactCount: number;

  @Column({ default: 0 })
  workflowCount: number;

  @Column({ default: false })
  feedbackSubmitted: boolean;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  createdAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  expiresAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  absoluteCloseAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  retentionExpiresAt: Date;
}
