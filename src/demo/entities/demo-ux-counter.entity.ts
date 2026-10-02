import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DemoUxOccurredEntity } from './demo-ux-occurred.entity';

@Entity('demo_ux_counter')
export class DemoUxCounterEntity extends DemoUxOccurredEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 24 })
  eventType: string;
}
