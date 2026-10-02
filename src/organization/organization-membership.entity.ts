import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from '../user/user.entity';
import { Role } from '../shared/enums/role.enums';
import { MembershipStatus } from './membership-status.enum';

@Entity('organization_membership')
@Index(['user', 'organization'], { unique: true })
export class OrganizationMembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, (user) => user.memberships, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @ManyToOne(
    () => OrganizationEntity,
    (organization) => organization.memberships,
    { nullable: false, onDelete: 'RESTRICT' },
  )
  @JoinColumn({ name: 'organizationId' })
  organization: OrganizationEntity;

  @Column('simple-array')
  roles: Role[];

  @Column({ type: 'text', default: MembershipStatus.ACTIVE })
  status: MembershipStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  deactivatedAt: Date | null;
}
