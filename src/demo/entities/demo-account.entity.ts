import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('demo_account')
@Index(['organizationId', 'username'], { unique: true })
export class DemoAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column({ length: 80 })
  organizationSlug: string;

  @Column({ length: 24 })
  username: string;

  @Column({ length: 72 })
  pinHash: string;

  @Column({ default: 0 })
  failedAttempts: number;

  @Column({ default: 0 })
  artifactCount: number;

  @Column({ default: 0 })
  workflowCount: number;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  lockedUntil: Date | null;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  createdAt: Date;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  expiresAt: Date;
}
