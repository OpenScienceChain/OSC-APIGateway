import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DemoUxOccurredEntity } from './demo-ux-occurred.entity';

@Entity('demo_ux_event')
export class DemoUxEventEntity extends DemoUxOccurredEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 64 })
  browserHash: string;

  @Column({ length: 32 })
  eventType: string;

  @Column({ length: 64 })
  route: string;

  @Column({ length: 16 })
  deviceCategory: string;
}
