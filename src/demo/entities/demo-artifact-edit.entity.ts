import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('demo_artifact_edit')
@Index(['recordId', 'requestId'], { unique: true })
@Index(['recordId', 'editNumber'], { unique: true })
export class DemoArtifactEditEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  recordId: string;

  @Column('uuid')
  requestId: string;

  @Column({ length: 64 })
  sessionHash: string;

  @Column({ length: 64 })
  payloadHash: string;

  @Column()
  editNumber: number;

  @Column({ nullable: true })
  baselineTxId: string | null;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  reservedAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  queuedAt: Date | null;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  retentionExpiresAt: Date;
}
