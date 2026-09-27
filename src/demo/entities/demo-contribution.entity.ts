import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DemoContributionType } from '../demo.enums';

@Entity('demo_contribution')
@Index(['recordType', 'recordId'], { unique: true })
@Index(['sessionHash', 'requestId'], { unique: true })
export class DemoContributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  recordType: DemoContributionType;

  @Column('uuid')
  recordId: string;

  @Column('uuid')
  requestId: string;

  @Column({ length: 64 })
  sessionHash: string;

  @Column('uuid')
  organizationId: string;

  @Column({ nullable: true })
  sizeBytes: number | null;

  @Column({ nullable: true, length: 12 })
  extension: string | null;

  @Column({ nullable: true, length: 64 })
  fingerprint: string | null;

  @Column({ nullable: true, length: 40 })
  researchContext: string | null;

  @Column({ nullable: true, length: 64 })
  createPayloadHash: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'simple-json' : 'jsonb',
    nullable: true,
  })
  artifactIds: string[] | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  acceptedAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  retentionExpiresAt: Date;
}
