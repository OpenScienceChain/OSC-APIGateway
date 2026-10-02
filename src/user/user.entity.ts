import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsArray,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Role } from '../shared/enums/role.enums';
import { OrganizationEntity } from '../organization/organization.entity';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';

@Entity()
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  username: string;

  @Column()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  password: string;

  @Column('simple-array')
  @ValidateIf((o, v) => v !== undefined)
  @IsArray()
  @IsEnum(Role, { each: true })
  roles: Role[];

  @Column({ default: false })
  platformAdmin: boolean;

  @Column({ default: 0 })
  authVersion: number;

  @OneToMany(
    () => OrganizationMembershipEntity,
    (membership) => membership.user,
  )
  memberships: OrganizationMembershipEntity[];

  // Retained temporarily so existing users can be migrated to memberships.
  @ManyToOne(() => OrganizationEntity, (org) => org.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn()
  organization: OrganizationEntity | null;
}
