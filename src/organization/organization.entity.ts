import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../user/user.entity';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { WorkflowEntity } from '../workflow/workflow.entity';
import { OrganizationMembershipEntity } from './organization-membership.entity';
import { OrganizationStatus } from './membership-status.enum';

@Entity()
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  slug?: string;

  @Index({ unique: true })
  @Column({ nullable: true })
  mspId?: string;

  @Column()
  description: string;

  @Column({ nullable: true })
  ledgerGroupName?: string;

  @Column({ nullable: true })
  ledgerApiUserId?: string;

  @Column({ nullable: true })
  artifactSchemaName?: string;

  @Column({ type: 'text', default: OrganizationStatus.ACTIVE })
  status: OrganizationStatus;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  archivedAt: Date | null;

  @OneToMany(
    () => OrganizationMembershipEntity,
    (membership) => membership.organization,
  )
  memberships: OrganizationMembershipEntity[];

  /* ---------- relación con usuarios ---------- */
  @OneToMany(() => UserEntity, (user) => user.organization, {
    cascade: true,
    onDelete: 'SET NULL',
  })
  users: UserEntity[];

  /* ---------- relación con artefactos ---------- */
  @OneToMany(() => ArtifactEntity, (artifact) => artifact.organization, {
    cascade: true,
    onDelete: 'RESTRICT',
  })
  artifacts: ArtifactEntity[];

  /* ---------- relación con workflows ---------- */
  @OneToMany(() => WorkflowEntity, (workflow) => workflow.organization, {
    cascade: true,
    onDelete: 'RESTRICT',
  })
  workflows: WorkflowEntity[];
}
