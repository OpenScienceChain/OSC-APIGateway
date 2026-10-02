import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('demo_ux_browser')
export class DemoUxBrowserEntity {
  @PrimaryColumn({ length: 64 })
  browserHash: string;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  consentedAt: Date;

  @Column({ type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp' })
  expiresAt: Date;
}
