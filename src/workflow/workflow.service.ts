import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WorkflowEntity } from './workflow.entity';
import { In, Repository } from 'typeorm';
import {
  BusinessError,
  BusinessLogicException,
} from '../shared/errors/business-errors';
import validator from 'validator';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { UpdateWorkflowWorkerDto } from './dto/update-workflow-worker.dto';
import { ListWorkflowDto } from './dto/list-workflow.dto';
import { GetWorkflowDto } from './dto/get-workflow.dto';
import { OrganizationEntity } from '../organization/organization.entity';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { OutboxService } from '../messaging/outbox.service';
import { randomUUID } from 'crypto';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';

interface SubmitterInfo {
  userId?: string;
  username: string;
  email: string;
  organizationId?: string;
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    @InjectRepository(WorkflowEntity)
    private readonly workflowRepository: Repository<WorkflowEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    @InjectRepository(ArtifactEntity)
    private readonly artifactRepository: Repository<ArtifactEntity>,
    private readonly rabbitMQService: RabbitMQService,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  private validateId(id: string, fieldName: string): void {
    if (!id || !validator.isUUID(id)) {
      throw new BusinessLogicException(
        `The ${fieldName} provided is not valid`,
        BusinessError.PRECONDITION_FAILED,
      );
    }
  }

  private async findOrganizationOrThrow(
    organizationId?: string,
  ): Promise<OrganizationEntity> {
    let organization: OrganizationEntity | null;
    if (organizationId) {
      this.validateId(organizationId, 'organizationId');
      organization = await this.organizationRepository.findOne({
        where: { id: organizationId },
      });
    } else {
      const organizations = await this.organizationRepository.find({ take: 2 });
      organization = organizations.length === 1 ? organizations[0] : null;
      if (organizations.length > 1) {
        throw new BusinessLogicException(
          'organizationId is required when more than one organization exists',
          BusinessError.PRECONDITION_FAILED,
        );
      }
    }
    if (!organization) {
      throw new BusinessLogicException(
        organizationId
          ? 'The selected organization does not exist'
          : 'No organization exists in the system',
        BusinessError.NOT_FOUND,
      );
    }
    return organization;
  }

  private async findWorkflowOrThrow(
    id: string,
    includeRelations: boolean = false,
  ): Promise<WorkflowEntity> {
    this.validateId(id, 'workflowId');

    const queryOptions: any = { where: { id } };
    if (includeRelations) {
      queryOptions.relations = ['organization', 'artifacts'];
    }

    const workflow = await this.workflowRepository.findOne(queryOptions);
    if (!workflow) {
      throw new BusinessLogicException(
        'The workflow with the provided id does not exist',
        BusinessError.NOT_FOUND,
      );
    }
    return workflow;
  }

  private async resolveArtifacts(
    artifactIds: string[] | undefined,
    organizationId: string,
  ): Promise<ArtifactEntity[]> {
    if (!artifactIds || artifactIds.length === 0) return [];

    for (const aid of artifactIds) {
      this.validateId(aid, 'artifactId');
    }

    const artifacts = await this.artifactRepository.find({
      where: { id: In(artifactIds), organization: { id: organizationId } },
    });

    if (artifacts.length !== artifactIds.length) {
      const foundIds = new Set(artifacts.map((a) => a.id));
      const missing = artifactIds.filter((id) => !foundIds.has(id));
      throw new BusinessLogicException(
        `The following artifact IDs do not exist in this organization: ${missing.join(', ')}`,
        BusinessError.PRECONDITION_FAILED,
      );
    }
    return artifacts;
  }

  private organizationContext(organization: OrganizationEntity) {
    return {
      id: organization.id,
      name: organization.name,
      ...(organization.slug && { slug: organization.slug }),
      ...(organization.mspId && { mspId: organization.mspId }),
      ...(organization.ledgerGroupName && {
        ledgerGroupName: organization.ledgerGroupName,
      }),
      ...(organization.ledgerApiUserId && {
        ledgerApiUserId: organization.ledgerApiUserId,
      }),
      ...(organization.artifactSchemaName && {
        artifactSchemaName: organization.artifactSchemaName,
      }),
    };
  }

  private requestMetadata(
    authenticatedUserId: string | undefined,
    organizationId: string,
    correlationId: string,
    operation: 'workflow.create' | 'workflow.update',
  ): import('../messaging/rabbitmq.service').TransactionRequestMetadata {
    if (!authenticatedUserId) {
      throw new BusinessLogicException(
        'Authenticated user identity is required for ledger operations',
        BusinessError.UNAUTHORIZED,
      );
    }
    return {
      authenticatedUserId,
      organizationId,
      correlationId,
      operation,
      requestedAt: new Date().toISOString(),
    };
  }

  private assertOrganizationAccess(
    workflow: WorkflowEntity,
    organizationId?: string,
  ): void {
    if (organizationId && workflow.organization?.id !== organizationId) {
      throw new BusinessLogicException(
        'The workflow does not belong to the authenticated organization',
        BusinessError.FORBIDDEN,
      );
    }
  }

  private assertReadAccess(
    workflow: WorkflowEntity,
    organizationId?: string,
  ): void {
    if (workflow.visibility === RecordVisibility.PUBLIC) return;
    if (!organizationId || workflow.organization?.id !== organizationId) {
      throw new BusinessLogicException(
        'The workflow is private to another organization',
        BusinessError.FORBIDDEN,
      );
    }
  }

  private validateCreateDto(dto: CreateWorkflowDto): void {
    if (!dto.title || dto.title.length < 3) {
      throw new BusinessLogicException(
        'The title of the workflow is required and must be at least 3 characters long',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    if (!dto.description || dto.description.length < 50) {
      throw new BusinessLogicException(
        'The description must be at least 50 characters long',
        BusinessError.BAD_REQUEST,
      );
    }

    if (
      !dto.submission_comment ||
      dto.submission_comment.trim().length < 20 ||
      dto.submission_comment.length > 1000
    ) {
      throw new BusinessLogicException(
        'The submission_comment is required and must be between 20 and 1000 characters long',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    if (dto.keywords) {
      const totalKeywordsLength = dto.keywords.join('').length;
      if (totalKeywordsLength > 1000) {
        throw new BusinessLogicException(
          'The keywords array can have at most 1000 characters in total',
          BusinessError.BAD_REQUEST,
        );
      }
    }
  }

  private async checkTitleUniqueness(
    title: string,
    organization: OrganizationEntity,
  ): Promise<void> {
    const existing = await this.workflowRepository.findOne({
      where: { title, organization: { id: organization.id } },
    });
    if (existing) {
      throw new BusinessLogicException(
        'A workflow with this title already exists in the organization',
        BusinessError.PRECONDITION_FAILED,
      );
    }
  }

  async create(
    dto: CreateWorkflowDto,
    submitterInfo: SubmitterInfo,
    correlationId?: string,
    recordId?: string,
  ): Promise<ListWorkflowDto> {
    if (!submitterInfo.email || !validator.isEmail(submitterInfo.email)) {
      throw new BusinessLogicException(
        'Invalid submitter email provided.',
        BusinessError.PRECONDITION_FAILED,
      );
    }
    if (!submitterInfo.username || submitterInfo.username.trim() === '') {
      throw new BusinessLogicException(
        'Invalid submitter username provided.',
        BusinessError.PRECONDITION_FAILED,
      );
    }
    if (!submitterInfo.userId) {
      throw new BusinessLogicException(
        'Authenticated user identity is required for ledger operations',
        BusinessError.UNAUTHORIZED,
      );
    }

    this.validateCreateDto(dto);

    const organization = await this.findOrganizationOrThrow(
      submitterInfo.organizationId,
    );
    await this.checkTitleUniqueness(dto.title, organization);

    const artifacts = await this.resolveArtifacts(
      dto.artifactIds,
      organization.id,
    );

    const newWorkflow = this.workflowRepository.create({
      ...(recordId ? { id: recordId } : {}),
      title: dto.title,
      description: dto.description,
      visibility: dto.visibility ?? RecordVisibility.PRIVATE,
      keywords: dto.keywords || [],
      githubRepositories: dto.githubRepositories || [],
      submission_comment: dto.submission_comment,
      organization,
      artifacts,
      submitterEmail: submitterInfo.email,
      submitterUsername: submitterInfo.username,
      submittedAt: new Date(),
      submissionState: SubmissionState.PENDING,
    });

    const requestCorrelationId = correlationId || randomUUID();
    let submitCommand: import('../messaging/rabbitmq.service').WorkflowSubmitCommand;
    let saved: WorkflowEntity;

    if (this.outboxService) {
      saved = await this.workflowRepository.manager.transaction(
        async (manager) => {
          const persisted = await manager.save(WorkflowEntity, newWorkflow);
          submitCommand = this.workflowSubmitCommand(
            persisted,
            organization,
            artifacts,
            submitterInfo.email,
            submitterInfo.userId,
            requestCorrelationId,
          );
          await this.outboxService.enqueue(
            manager,
            'workflow.submit',
            persisted.id,
            { ...submitCommand },
            requestCorrelationId,
          );
          return persisted;
        },
      );
      void this.outboxService.dispatchPending();
    } else {
      saved = await this.workflowRepository.save(newWorkflow);
      submitCommand = this.workflowSubmitCommand(
        saved,
        organization,
        artifacts,
        submitterInfo.email,
        submitterInfo.userId,
        requestCorrelationId,
      );
      this.rabbitMQService.publishWorkflowSubmit(submitCommand).catch((err) => {
        this.logger.error(
          `Failed to publish workflow.submit for ${saved.id} [corrId=${correlationId ?? 'none'}]: ${err?.message ?? err}`,
        );
      });
    }

    return {
      id: saved.id,
      title: saved.title,
      description: saved.description,
      visibility: saved.visibility,
      keywords: saved.keywords,
      submissionState: saved.submissionState,
      submittedAt: saved.submittedAt,
      updatedAt: saved.updatedAt,
    };
  }

  private workflowSubmitCommand(
    workflow: WorkflowEntity,
    organization: OrganizationEntity,
    artifacts: ArtifactEntity[],
    contributor: string,
    authenticatedUserId: string,
    correlationId: string,
  ): import('../messaging/rabbitmq.service').WorkflowSubmitCommand {
    return {
      contractVersion: 'v3',
      workflowId: workflow.id,
      organization: this.organizationContext(organization),
      title: workflow.title,
      visibility: workflow.visibility,
      description: workflow.description,
      submission_comment: workflow.submission_comment,
      keywords: workflow.keywords,
      githubRepositories: workflow.githubRepositories,
      artifactIds: artifacts.map((a) => a.id),
      contributor,
      correlationId,
      request: this.requestMetadata(
        authenticatedUserId,
        organization.id,
        correlationId,
        'workflow.create',
      ),
    };
  }

  async findAll(organizationId?: string): Promise<ListWorkflowDto[]> {
    const workflows = await this.workflowRepository.find({
      where: organizationId
        ? [
            { visibility: RecordVisibility.PUBLIC },
            { organization: { id: organizationId } },
          ]
        : { visibility: RecordVisibility.PUBLIC },
    });
    return workflows.map((w) => ({
      id: w.id,
      title: w.title,
      description: w.description,
      visibility: w.visibility,
      keywords: w.keywords,
      submissionState: w.submissionState,
      submittedAt: w.submittedAt,
      updatedAt: w.updatedAt,
    }));
  }

  async findOne(id: string, organizationId?: string): Promise<GetWorkflowDto> {
    const workflow = await this.findWorkflowOrThrow(id, true);
    this.assertReadAccess(workflow, organizationId);

    return {
      id: workflow.id,
      title: workflow.title,
      description: workflow.description,
      visibility: workflow.visibility,
      submission_comment: workflow.submission_comment,
      keywords: workflow.keywords,
      githubRepositories: workflow.githubRepositories,
      artifacts: (workflow.artifacts || []).map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
      })),
      submissionState: workflow.submissionState,
      submitterEmail: workflow.submitterEmail,
      submitterUsername: workflow.submitterUsername,
      submittedAt: workflow.submittedAt,
      updatedAt: workflow.updatedAt,
      blockchainTxId: workflow.blockchainTxId,
      peerId: workflow.peerId,
      submissionError: workflow.submissionError,
      organization: workflow.organization
        ? { name: workflow.organization.name }
        : undefined,
    };
  }

  async updateUser(
    id: string,
    dto: UpdateWorkflowDto,
    contributorEmail?: string,
    correlationId?: string,
    organizationId?: string,
    authenticatedUserId?: string,
  ): Promise<WorkflowEntity> {
    this.validateId(id, 'workflowId');

    if ('title' in dto || 'description' in dto) {
      throw new BusinessLogicException(
        'Cannot update title or description',
        BusinessError.BAD_REQUEST,
      );
    }

    if (
      !dto.submission_comment ||
      dto.submission_comment.trim().length < 20 ||
      dto.submission_comment.length > 1000
    ) {
      throw new BusinessLogicException(
        'The submission_comment is required and must be between 20 and 1000 characters long',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    const workflow = await this.findWorkflowOrThrow(id, true);
    this.assertOrganizationAccess(workflow, organizationId);

    if (dto.keywords !== undefined) {
      const totalKeywordsLength = dto.keywords.join('').length;
      if (totalKeywordsLength > 1000) {
        throw new BusinessLogicException(
          'The keywords array can have at most 1000 characters in total',
          BusinessError.BAD_REQUEST,
        );
      }
      workflow.keywords = dto.keywords;
    }

    if (dto.githubRepositories !== undefined) {
      workflow.githubRepositories = dto.githubRepositories as any;
    }

    if (dto.artifactIds !== undefined) {
      workflow.artifacts = await this.resolveArtifacts(
        dto.artifactIds,
        workflow.organization.id,
      );
    }

    workflow.submission_comment = dto.submission_comment;

    const requestCorrelationId = correlationId || randomUUID();
    const updateCommand: import('../messaging/rabbitmq.service').WorkflowUpdateCommand =
      {
        contractVersion: 'v3',
        workflowId: id,
        organization: this.organizationContext(workflow.organization),
        patch: {
          title: workflow.title,
          description: workflow.description,
          submission_comment: dto.submission_comment,
          keywords: workflow.keywords,
          githubRepositories: workflow.githubRepositories,
          artifactIds: (workflow.artifacts || []).map((a) => a.id),
          contributor: contributorEmail,
        },
        contributor: contributorEmail,
        correlationId: requestCorrelationId,
        request: this.requestMetadata(
          authenticatedUserId,
          workflow.organization.id,
          requestCorrelationId,
          'workflow.update',
        ),
      };

    let saved: WorkflowEntity;
    if (this.outboxService) {
      saved = await this.workflowRepository.manager.transaction(
        async (manager) => {
          const persisted = await manager.save(WorkflowEntity, workflow);
          await this.outboxService.enqueue(
            manager,
            'workflow.update',
            id,
            { ...updateCommand },
            requestCorrelationId,
          );
          return persisted;
        },
      );
      void this.outboxService.dispatchPending();
    } else {
      saved = await this.workflowRepository.save(workflow);
      this.rabbitMQService.publishWorkflowUpdate(updateCommand).catch((err) => {
        this.logger.error(
          `Failed to publish workflow.update for ${id} [corrId=${correlationId ?? 'none'}]: ${err?.message ?? err}`,
        );
      });
    }

    return saved;
  }

  async updateWorker(
    id: string,
    dto: UpdateWorkflowWorkerDto,
  ): Promise<WorkflowEntity> {
    const workflow = await this.findWorkflowOrThrow(id);

    const allowedFields = [
      'submissionState',
      'blockchainTxId',
      'peerId',
      'submissionError',
      'updatedAt',
    ];
    const receivedFields = Object.keys(dto);
    const forbiddenFields = receivedFields.filter(
      (f) => !allowedFields.includes(f),
    );
    if (forbiddenFields.length > 0) {
      throw new BusinessLogicException(
        `Cannot update the following fields in status update: ${forbiddenFields.join(', ')}. Only allowed: ${allowedFields.join(', ')}`,
        BusinessError.BAD_REQUEST,
      );
    }

    if (dto.submissionState !== undefined) {
      workflow.submissionState = dto.submissionState;
    }
    if (dto.blockchainTxId) {
      workflow.blockchainTxId = dto.blockchainTxId;
    }
    if (dto.peerId) {
      workflow.peerId = dto.peerId;
    }
    if (dto.submissionError) {
      workflow.submissionError = dto.submissionError;
    }

    if (dto.submissionState === SubmissionState.SUCCESS) {
      if (dto.updatedAt) {
        workflow.updatedAt = new Date(dto.updatedAt);
      }
      workflow.submissionError = null;
    }

    if (dto.submissionState === SubmissionState.FAILED && dto.submissionError) {
      const isUpdateEvent = !!dto.updatedAt;
      const prefix = isUpdateEvent
        ? 'Error updating the workflow. Details: '
        : 'Error submitting the workflow. Details: ';
      workflow.submissionError = `${prefix}${dto.submissionError}`;
    }

    return await this.workflowRepository.save(workflow);
  }
}
