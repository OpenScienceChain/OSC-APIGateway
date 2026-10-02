import {
  Column,
  Entity,
  ManyToOne,
  ManyToMany,
  JoinTable,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  IsNotEmpty,
  IsString,
  IsDate,
  IsArray,
  IsEmail,
  IsEnum,
  Length,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { Type } from 'class-transformer';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';
import { OrganizationEntity } from '../organization/organization.entity';

export class RepositoryContent {
  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  hash: string;
}

export class GitHubRepositoryItem {
  @IsString()
  @IsNotEmpty()
  url: string;

  @IsString()
  @IsOptional()
  description: string;

  @IsString()
  @IsOptional()
  gitHash: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepositoryContent)
  @IsOptional()
  contents: RepositoryContent[];
}

@Entity()
export class WorkflowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /* --------------- Core fields --------------- */

  @Column()
  @IsString()
  @IsNotEmpty()
  @Length(3, 200)
  title: string;

  @Column()
  @IsString()
  @IsNotEmpty()
  @Length(50, 3000)
  description: string;

  @Column({ type: 'text', default: RecordVisibility.PRIVATE })
  @IsEnum(RecordVisibility)
  visibility: RecordVisibility;

  @Column({ type: 'simple-array', nullable: true })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  keywords: string[];

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'simple-json' : 'jsonb',
    default: '[]',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GitHubRepositoryItem)
  githubRepositories: GitHubRepositoryItem[];

  /* --------------- Submitter --------------- */

  @Column()
  @IsEmail()
  @IsNotEmpty()
  submitterEmail: string;

  @Column()
  @IsString()
  @IsNotEmpty()
  submitterUsername: string;

  @Column()
  @IsString()
  @IsNotEmpty()
  @Length(20, 1000)
  submission_comment: string;

  /* --------------- States & dates --------------- */

  @Column({
    type: 'text',
    enum: SubmissionState,
    default: SubmissionState.PENDING,
  })
  @IsEnum(SubmissionState)
  submissionState: SubmissionState;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  @IsDate()
  @IsOptional()
  submittedAt: Date;

  @Column({
    type: process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamp',
    nullable: true,
  })
  @IsDate()
  @IsOptional()
  updatedAt: Date;

  /* --------------- Blockchain fields --------------- */

  @Column({ nullable: true })
  @IsString()
  @IsOptional()
  blockchainTxId?: string;

  @Column({ nullable: true })
  @IsString()
  @IsOptional()
  peerId?: string;

  @Column({ type: 'text', nullable: true })
  @IsString()
  @IsOptional()
  submissionError?: string;

  /* --------------- Relationships --------------- */

  @ManyToOne(() => OrganizationEntity, (org: any) => org.workflows, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @IsNotEmpty()
  organization: any;

  @ManyToMany(() => ArtifactEntity, { eager: false })
  @JoinTable({ name: 'workflow_artifacts' })
  artifacts: ArtifactEntity[];
}
