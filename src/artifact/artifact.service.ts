import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArtifactEntity } from './artifact.entity';
import { IsNull, Repository } from 'typeorm';
import {
  BusinessError,
  BusinessLogicException,
} from '../shared/errors/business-errors';
import validator from 'validator';
import { CreateArtifactDto } from './dto/create-artifact.dto';
import { UpdateArtifactWorkerDto } from './dto/update-artifact-worker.dto';
import { UpdateArtifactUserDto } from './dto/update-artifact-user.dto';

import { GetArtifactDto } from './dto/get-artifact.dto';
import { ListArtifactDto } from './dto/list-artifact.dto';
import { OrganizationEntity } from '../organization/organization.entity';
import { SubmissionState } from './enums/submission-state.enum';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { GhwService } from './ghw.service';
import { randomUUID } from 'crypto';
import { OutboxService } from '../messaging/outbox.service';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';

// Definir una interfaz para la información del creador del artefacto
interface SubmitterInfo {
  userId?: string;
  username: string;
  email: string;
  organizationId?: string;
}

@Injectable()
export class ArtifactService {
  private readonly logger = new Logger(ArtifactService.name);

  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactRepository: Repository<ArtifactEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    private readonly rabbitMQService: RabbitMQService,
    private readonly ghwService: GhwService,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  // Private helper methods to reduce code duplication

  /**
   * Validates if the provided ID is a valid UUID
   * @param id The ID to validate
   * @param fieldName The name of the field for error messages
   * @throws BusinessLogicException if the ID is invalid
   */
  private validateId(id: string, fieldName: string): void {
    if (!id || !validator.isUUID(id)) {
      throw new BusinessLogicException(
        `The ${fieldName} provided is not valid`,
        BusinessError.PRECONDITION_FAILED,
      );
    }
  }

  /**
   * Finds the single organization in the system or throws an exception if not found
   * @returns The organization entity
   * @throws BusinessLogicException if no organization is found
   */
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

  /**
   * Finds an artifact by ID or throws an exception if not found
   * @param id The artifact ID
   * @param includeRelations Whether to include relations in the query
   * @returns The artifact entity
   * @throws BusinessLogicException if the artifact is not found
   */
  private async findArtifactOrThrow(
    id: string,
    includeRelations: boolean = false,
  ): Promise<ArtifactEntity> {
    this.validateId(id, 'artifactId');

    const queryOptions: any = {
      where: { id },
    };

    if (includeRelations) {
      queryOptions.relations = ['organization'];
    }

    const artifact = await this.artifactRepository.findOne(queryOptions);

    if (!artifact) {
      throw new BusinessLogicException(
        'The artifact with the provided id does not exist',
        BusinessError.NOT_FOUND,
      );
    }

    return artifact;
  }

  private assertOrganizationAccess(
    artifact: ArtifactEntity,
    organizationId?: string,
  ): void {
    if (organizationId && artifact.organization?.id !== organizationId) {
      throw new BusinessLogicException(
        'The artifact does not belong to the authenticated organization',
        BusinessError.FORBIDDEN,
      );
    }
  }

  private assertReadAccess(
    artifact: ArtifactEntity,
    organizationId?: string,
  ): void {
    if (artifact.visibility === RecordVisibility.PUBLIC) return;
    if (!organizationId || artifact.organization?.id !== organizationId) {
      throw new BusinessLogicException(
        'The artifact is private to another organization',
        BusinessError.FORBIDDEN,
      );
    }
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
    operation: 'artifact.create' | 'artifact.update',
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

  /**
   * Validates the create artifact DTO
   * @param createArtifactDto The DTO to validate
   * @throws BusinessLogicException if validation fails
   */
  private validateCreateArtifactDto(
    createArtifactDto: CreateArtifactDto,
  ): void {
    if (!createArtifactDto.title || createArtifactDto.title.length < 3) {
      throw new BusinessLogicException(
        'The title of the artifact is required and must be at least 3 characters long',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    if (
      !createArtifactDto.description ||
      createArtifactDto.description.length < 50
    ) {
      throw new BusinessLogicException(
        'The description must be at least 50 characters long',
        BusinessError.BAD_REQUEST,
      );
    }

    if (
      !createArtifactDto.submission_comment ||
      createArtifactDto.submission_comment.trim().length < 20 ||
      createArtifactDto.submission_comment.length > 1000
    ) {
      throw new BusinessLogicException(
        'The submission_comment is required and must be between 20 and 1000 characters long',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    if (
      !createArtifactDto.footprint ||
      !/^[a-f0-9]{64}$/.test(createArtifactDto.footprint)
    ) {
      throw new BusinessLogicException(
        'A valid SHA-256 footprint hash is required (64 hex characters).',
        BusinessError.PRECONDITION_FAILED,
      );
    }

    const totalKeywordsLength = createArtifactDto.keywords.join('').length;
    if (totalKeywordsLength > 1000) {
      throw new BusinessLogicException(
        'The keywords array can have at most 1000 characters in total',
        BusinessError.BAD_REQUEST,
      );
    }

    const totalLinksLength = createArtifactDto.links.join('').length;
    if (totalLinksLength > 2000) {
      throw new BusinessLogicException(
        'The links array can have at most 2000 characters in total',
        BusinessError.BAD_REQUEST,
      );
    }

    // Validate each link
    for (const link of createArtifactDto.links) {
      if (!validator.isURL(link)) {
        throw new BusinessLogicException(
          'Each link in the links array must be a valid URL',
          BusinessError.BAD_REQUEST,
        );
      }
    }
  }

  /**
   * Checks if an artifact with the same title already exists in the organization
   * @param title The title to check
   * @throws BusinessLogicException if an artifact with the same title exists
   */
  private async checkTitleUniqueness(
    title: string,
    organization: OrganizationEntity,
  ): Promise<void> {
    const existingArtifact = await this.artifactRepository.findOne({
      where: {
        title,
        organization: { id: organization.id },
      },
    });

    if (existingArtifact) {
      throw new BusinessLogicException(
        'An artifact with this title already exists in the organization',
        BusinessError.PRECONDITION_FAILED,
      );
    }
  }

  /**
   * Validates the update artifact DTO
   * @param updateArtifactDto The DTO to validate
   * @throws BusinessLogicException if validation fails
   */
  private validateUpdateArtifactDto(
    updateArtifactDto: UpdateArtifactWorkerDto,
  ): void {
    if (
      'title' in updateArtifactDto ||
      'contributor' in updateArtifactDto ||
      'description' in updateArtifactDto ||
      'keywords' in updateArtifactDto ||
      'links' in updateArtifactDto ||
      'dois' in updateArtifactDto ||
      'fundingAgencies' in updateArtifactDto ||
      'acknowledgements' in updateArtifactDto ||
      'fileName' in updateArtifactDto ||
      'manifest' in updateArtifactDto ||
      'footprint' in updateArtifactDto ||
      'organization' in updateArtifactDto
    ) {
      throw new BusinessLogicException(
        'Cannot update title, contributor, or submittedAt fields',
        BusinessError.BAD_REQUEST,
      );
    }
  }

  /**
   * Validates the update artifact DTO for status updates
   * @param updateStatusDto The DTO to validate
   * @throws BusinessLogicException if validation fails
   */
  private validateUpdateStatusDto(
    updateStatusDto: UpdateArtifactWorkerDto,
  ): void {
    const allowedFields = [
      'submissionState',
      'blockchainTxId',
      'peerId',
      'submissionError',
      'updatedAt',
    ];
    const receivedFields = Object.keys(updateStatusDto);

    const forbiddenFields = receivedFields.filter(
      (field) => !allowedFields.includes(field),
    );

    if (forbiddenFields.length > 0) {
      throw new BusinessLogicException(
        `Cannot update the following fields in status update: ${forbiddenFields.join(', ')}. Only allowed: ${allowedFields.join(', ')}`,
        BusinessError.BAD_REQUEST,
      );
    }
  }

  // Update artifact details (PI / Collaborator)
  async updateUser(
    id: string,
    dto: UpdateArtifactUserDto,
    contributorEmail?: string,
    correlationId?: string,
    organizationId?: string,
    authenticatedUserId?: string,
  ): Promise<ArtifactEntity> {
    // Validate ID
    this.validateId(id, 'artifactId');

    // Disallow updating title or description if somehow included
    if ('title' in dto || 'description' in dto) {
      throw new BusinessLogicException(
        'Cannot update title or description',
        BusinessError.BAD_REQUEST,
      );
    }

    // Require submission_comment on every user update and validate bounds
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

    // Fetch current artifact for validation purposes (do not persist changes here)
    const currentArtifact = await this.findArtifactOrThrow(id, true);
    this.assertOrganizationAccess(currentArtifact, organizationId);

    // Re‐run create validations on a simulated merged artefact to ensure constraints hold
    this.validateCreateArtifactDto({
      ...currentArtifact,
      ...dto,
      title: currentArtifact.title,
      description: currentArtifact.description,
    } as any);

    // Build the patch with only provided properties
    const patch: import('../messaging/rabbitmq.service').ArtifactUpdateCommandPatch =
      {};
    // Always include chaincode-mandatory fields from the existing artifact
    patch.title = currentArtifact.title;
    patch.description = currentArtifact.description;
    if (contributorEmail !== undefined) patch.contributor = contributorEmail;
    const dtoAny: any = dto as any;
    if (dtoAny.submission_comment !== undefined)
      patch.submission_comment = dtoAny.submission_comment;
    if (dtoAny.keywords !== undefined) patch.keywords = dtoAny.keywords;
    if (dtoAny.links !== undefined) patch.links = dtoAny.links;
    if (dtoAny.dois !== undefined) patch.dois = dtoAny.dois;
    if (dtoAny.fundingAgencies !== undefined)
      patch.fundingAgencies = dtoAny.fundingAgencies;
    if (dtoAny.acknowledgements !== undefined)
      patch.acknowledgements = dtoAny.acknowledgements;
    if (dtoAny.manifest !== undefined) patch.manifest = dtoAny.manifest;
    if (dtoAny.footprint !== undefined) patch.footprint = dtoAny.footprint;
    // User is not allowed to change status fields

    // Persist user-field changes immediately on our DB
    currentArtifact.submission_comment = dto.submission_comment;
    if (patch.keywords !== undefined) currentArtifact.keywords = patch.keywords;
    if (patch.links !== undefined) currentArtifact.links = patch.links;
    if (patch.dois !== undefined) currentArtifact.dois = patch.dois;
    if (patch.fundingAgencies !== undefined)
      currentArtifact.fundingAgencies = patch.fundingAgencies;
    if (patch.acknowledgements !== undefined)
      currentArtifact.acknowledgements = patch.acknowledgements;
    if (patch.manifest !== undefined)
      currentArtifact.manifest = patch.manifest as any;
    if (patch.footprint !== undefined)
      currentArtifact.footprint = patch.footprint;

    const requestCorrelationId = correlationId || randomUUID();
    const updateCommand: import('../messaging/rabbitmq.service').ArtifactUpdateCommand =
      {
        contractVersion: 'v3',
        artifactId: id,
        organization: this.organizationContext(currentArtifact.organization),
        patch,
        contributor: contributorEmail,
        correlationId: requestCorrelationId,
        request: this.requestMetadata(
          authenticatedUserId,
          currentArtifact.organization.id,
          requestCorrelationId,
          'artifact.update',
        ),
      };

    let saved: ArtifactEntity;
    if (this.outboxService) {
      saved = await this.artifactRepository.manager.transaction(
        async (manager) => {
          const persisted = await manager.save(ArtifactEntity, currentArtifact);
          await this.outboxService.enqueue(
            manager,
            'artifact.update',
            id,
            { ...updateCommand },
            requestCorrelationId,
          );
          return persisted;
        },
      );
      void this.outboxService.dispatchPending();
    } else {
      saved = await this.artifactRepository.save(currentArtifact);
      this.rabbitMQService.publishArtifactUpdate(updateCommand).catch((err) => {
        this.logger.error(
          `Failed to publish artifact.update for ${id} [corrId=${correlationId ?? 'none'}]: ${err?.message ?? err}`,
        );
      });
    }

    return saved;
  }

  // Get All Artifacts - Return minimal fields
  async findAll(organizationId?: string): Promise<ListArtifactDto[]> {
    const artifacts = await this.artifactRepository.find({
      where: organizationId
        ? [
            { visibility: RecordVisibility.PUBLIC, archivedAt: IsNull() },
            { organization: { id: organizationId }, archivedAt: IsNull() },
          ]
        : { visibility: RecordVisibility.PUBLIC, archivedAt: IsNull() },
    });

    return artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      description: artifact.description,
      visibility: artifact.visibility,
      keywords: artifact.keywords,
      footprint: artifact.footprint,
      submittedAt: artifact.submittedAt,
      verified: artifact.verified,
      updatedAt: artifact.updatedAt,
    }));
  }

  // Get One Artifact - Return all fields
  async findOne(id: string, organizationId?: string): Promise<GetArtifactDto> {
    // Find the artifact with the organization relation
    const artifact = await this.findArtifactOrThrow(id, true);
    this.assertReadAccess(artifact, organizationId);

    // Transform the result to include all fields
    return {
      id: artifact.id,
      title: artifact.title,
      description: artifact.description,
      visibility: artifact.visibility,
      submission_comment: artifact.submission_comment,
      keywords: artifact.keywords,
      footprint: artifact.footprint,
      links: artifact.links,
      dois: artifact.dois,
      fundingAgencies: artifact.fundingAgencies,
      acknowledgements: artifact.acknowledgements,
      manifest: artifact.manifest,
      verified: artifact.verified,
      submissionState: artifact.submissionState,
      submitterEmail: artifact.submitterEmail,
      submitterUsername: artifact.submitterUsername,
      submittedAt: artifact.submittedAt,
      updatedAt: artifact.updatedAt,
      blockchainTxId: artifact.blockchainTxId,
      peerId: artifact.peerId,
      submissionError: artifact.submissionError,
      organization: artifact.organization
        ? {
            name: artifact.organization.name,
            // Do not include other organization fields like description, id
          }
        : undefined,
    };
  }

  // --- History via GHW ---
  async getHistory(
    id: string,
    params: {
      offset?: string;
      limit?: string;
      order?: 'asc' | 'desc';
      includeValue?: string;
    },
    correlationId?: string,
    organizationId?: string,
  ): Promise<any> {
    const artifact = await this.findArtifactOrThrow(id, true);
    this.assertReadAccess(artifact, organizationId);
    const artifactId = id.toLowerCase();

    const offset = Math.max(0, Number(params.offset ?? 0) || 0);
    let limit = Number(params.limit ?? 100) || 100;
    if (limit < 1) limit = 1;
    if (limit > 500) limit = 500;
    const order =
      params.order === 'asc' || params.order === 'desc' ? params.order : 'desc';
    const includeValue =
      params.includeValue === undefined
        ? true
        : String(params.includeValue).toLowerCase() !== 'false';

    const corr = correlationId || randomUUID();

    try {
      const resp = await this.ghwService.fetchHistory(
        {
          artifactId,
          assetType: 'artifact',
          organizationId: artifact.organization?.id || organizationId,
          offset,
          limit,
          order,
          includeValue,
        },
        corr,
      );
      return {
        ...resp,
        nextOffset: resp?.hasMore ? offset + limit : undefined,
      };
    } catch (err: any) {
      if (
        err?.message === 'CONNECT_TIMEOUT' ||
        err?.message === 'READ_TIMEOUT'
      ) {
        throw new BusinessLogicException(
          'Upstream timeout contacting GHW',
          BusinessError.GATEWAY_TIMEOUT,
        );
      }
      const status = err?.statusCode;
      if (status) {
        throw new BusinessLogicException(
          `GHW error ${status}`,
          BusinessError.BAD_GATEWAY,
        );
      }
      throw new BusinessLogicException('GHW error', BusinessError.BAD_GATEWAY);
    }
  }

  async refreshHistory(
    id: string,
    correlationId?: string,
    organizationId?: string,
  ): Promise<any> {
    const artifact = await this.findArtifactOrThrow(id, true);
    this.assertReadAccess(artifact, organizationId);
    const artifactId = id.toLowerCase();
    const corr = correlationId || randomUUID();
    try {
      return await this.ghwService.refresh(
        artifactId,
        corr,
        artifact.organization?.id || organizationId,
      );
    } catch (err: any) {
      if (
        err?.message === 'CONNECT_TIMEOUT' ||
        err?.message === 'READ_TIMEOUT'
      ) {
        throw new BusinessLogicException(
          'Upstream timeout contacting GHW',
          BusinessError.GATEWAY_TIMEOUT,
        );
      }
      const status = err?.statusCode;
      if (status) {
        throw new BusinessLogicException(
          `GHW error ${status}`,
          BusinessError.BAD_GATEWAY,
        );
      }
      throw new BusinessLogicException('GHW error', BusinessError.BAD_GATEWAY);
    }
  }

  // Create one Artifact
  async create(
    createArtifactDto: CreateArtifactDto,
    submitterInfo: SubmitterInfo,
    correlationId?: string,
    recordId?: string,
  ): Promise<ListArtifactDto> {
    // Validate the creator's information
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

    // Validate the DTO
    this.validateCreateArtifactDto(createArtifactDto);

    // Find the organization
    const organization = await this.findOrganizationOrThrow(
      submitterInfo.organizationId,
    );

    // Check if an artifact with this title already exists for this organization
    await this.checkTitleUniqueness(createArtifactDto.title, organization);

    // Create new artifact
    const newArtifact = this.artifactRepository.create({
      ...(recordId ? { id: recordId } : {}),
      ...createArtifactDto,
      visibility: createArtifactDto.visibility ?? RecordVisibility.PRIVATE,
      organization: organization,
      submitterEmail: submitterInfo.email,
      submitterUsername: submitterInfo.username,
      submittedAt: new Date(),
      submissionState: SubmissionState.PENDING,
    });

    const requestCorrelationId = correlationId || randomUUID();
    let submitCommand: import('../messaging/rabbitmq.service').ArtifactSubmitCommand;
    let savedArtifact: ArtifactEntity;

    if (this.outboxService) {
      savedArtifact = await this.artifactRepository.manager.transaction(
        async (manager) => {
          const persisted = await manager.save(ArtifactEntity, newArtifact);
          submitCommand = this.artifactSubmitCommand(
            persisted,
            organization,
            submitterInfo.email,
            submitterInfo.userId,
            requestCorrelationId,
          );
          await this.outboxService.enqueue(
            manager,
            'artifact.submit',
            persisted.id,
            { ...submitCommand },
            requestCorrelationId,
          );
          return persisted;
        },
      );
      void this.outboxService.dispatchPending();
    } else {
      savedArtifact = await this.artifactRepository.save(newArtifact);
      submitCommand = this.artifactSubmitCommand(
        savedArtifact,
        organization,
        submitterInfo.email,
        submitterInfo.userId,
        requestCorrelationId,
      );
      this.rabbitMQService.publishArtifactSubmit(submitCommand).catch((err) => {
        this.logger.error(
          `Failed to publish artifact.submit for ${savedArtifact.id} [corrId=${correlationId ?? 'none'}]: ${err?.message ?? err}`,
        );
      });
    }

    return {
      id: savedArtifact.id,
      title: savedArtifact.title,
      description: savedArtifact.description,
      visibility: savedArtifact.visibility,
      keywords: savedArtifact.keywords,
      footprint: savedArtifact.footprint,
      submittedAt: savedArtifact.submittedAt,
      verified: savedArtifact.verified,
      updatedAt: savedArtifact.updatedAt,
    };
  }

  private artifactSubmitCommand(
    artifact: ArtifactEntity,
    organization: OrganizationEntity,
    contributor: string,
    authenticatedUserId: string,
    correlationId: string,
  ): import('../messaging/rabbitmq.service').ArtifactSubmitCommand {
    return {
      contractVersion: 'v3',
      artifactId: artifact.id,
      organization: this.organizationContext(organization),
      manifest: artifact.manifest,
      title: artifact.title,
      visibility: artifact.visibility,
      footprint: artifact.footprint,
      description: artifact.description,
      submission_comment: artifact.submission_comment,
      keywords: artifact.keywords,
      links: artifact.links,
      dois: artifact.dois,
      fundingAgencies: artifact.fundingAgencies,
      acknowledgements: artifact.acknowledgements,
      contributor,
      correlationId,
      request: this.requestMetadata(
        authenticatedUserId,
        organization.id,
        correlationId,
        'artifact.create',
      ),
    };
  }

  // Update an Artifact (General Purpose - Limited fields)
  async update(
    id: string,
    updateArtifactDto: UpdateArtifactWorkerDto,
  ): Promise<ArtifactEntity> {
    // Find the artifact with the organization relation
    const artifact = await this.findArtifactOrThrow(id, true);

    // Validate update fields
    this.validateUpdateArtifactDto(updateArtifactDto);

    // Apply the updates
    Object.assign(artifact, updateArtifactDto);
    return await this.artifactRepository.save(artifact);
  }

  // Archive an Artifact while retaining its provenance links.
  async delete(id: string, organizationId?: string): Promise<void> {
    const artifact = await this.findArtifactOrThrow(id, true);
    this.assertOrganizationAccess(artifact, organizationId);
    artifact.visibility = RecordVisibility.PRIVATE;
    artifact.archivedAt = new Date();
    await this.artifactRepository.save(artifact);
  }

  async updateWorker(
    id: string,
    updateStatusDto: UpdateArtifactWorkerDto,
  ): Promise<ArtifactEntity> {
    const artifact = await this.findArtifactOrThrow(id);

    // Validate that only allowed fields are being updated
    this.validateUpdateStatusDto(updateStatusDto);

    // Update the artifact with the new status information
    if (updateStatusDto.submissionState !== undefined) {
      artifact.submissionState = updateStatusDto.submissionState;
    }

    // submittedAt cannot be modified; ignore if present

    if (updateStatusDto.blockchainTxId) {
      artifact.blockchainTxId = updateStatusDto.blockchainTxId;
    }

    if (updateStatusDto.peerId) {
      artifact.peerId = updateStatusDto.peerId;
    }

    if (updateStatusDto.submissionError) {
      artifact.submissionError = updateStatusDto.submissionError;
    }

    // verified cannot be modified by worker DTO; ignore

    // On SUCCESS: set updatedAt if provided and clear any previous submissionError
    if (updateStatusDto.submissionState === SubmissionState.SUCCESS) {
      if (updateStatusDto.updatedAt) {
        artifact.updatedAt = new Date(updateStatusDto.updatedAt);
      }
      artifact.submissionError = null;
    }

    // On FAILED, ensure submissionError is set with a concise message and DO NOT change updatedAt
    if (
      updateStatusDto.submissionState === SubmissionState.FAILED &&
      updateStatusDto.submissionError
    ) {
      const isUpdateEvent = !!updateStatusDto.updatedAt; // updatedAt present implies update event
      const prefix = isUpdateEvent
        ? 'Error updating the artifact. Details: '
        : 'Error submitting the artifact. Details: ';
      artifact.submissionError = `${prefix}${updateStatusDto.submissionError}`;
    }

    return await this.artifactRepository.save(artifact);
  }
}
