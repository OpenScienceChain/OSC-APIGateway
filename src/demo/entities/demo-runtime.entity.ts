import { Column, Entity, PrimaryColumn } from 'typeorm';
import { DemoLifecycleState } from '../demo.enums';

@Entity('demo_runtime')
export class DemoRuntimeEntity {
  @PrimaryColumn({ length: 40 })
  id: string;

  @Column({ type: 'text', default: DemoLifecycleState.SCHEDULED })
  state: DemoLifecycleState;

  @Column({ nullable: true, length: 128 })
  runId: string | null;

  @Column({ nullable: true, length: 300 })
  reason: string | null;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  opensAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  closesAt: Date;

  @Column({ default: 0 })
  artifactReservations: number;

  @Column({ default: 0 })
  workflowReservations: number;

  @Column({ default: 0 })
  sessionReservations: number;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
  })
  updatedAt: Date;
}
