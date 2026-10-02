import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OrganizationEntity } from './organization.entity';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BusinessError,
  BusinessLogicException,
} from '../shared/errors/business-errors';
import {
  OrganizationResponseDto,
  UserForOrganizationDto,
} from './organization.dto';
import { OrganizationStatus } from './membership-status.enum';

@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
  ) {}

  // Transform Organization to DTO, excluding sensitive data
  private transformToDto(
    organization: OrganizationEntity,
  ): OrganizationResponseDto {
    const {
      id,
      name,
      description,
      slug,
      mspId,
      status,
      archivedAt,
      ledgerGroupName,
      ledgerApiUserId,
      artifactSchemaName,
      memberships,
      artifacts,
    } = organization;

    // Transform users to exclude passwords
    const transformedUsers: UserForOrganizationDto[] = memberships
      ? memberships.map((membership) => {
          const { id, name, username, email } = membership.user;
          return {
            id,
            name,
            username,
            email,
            roles: membership.roles,
            membershipId: membership.id,
            membershipStatus: membership.status,
          };
        })
      : [];

    return {
      id,
      name,
      description,
      slug,
      mspId,
      status,
      archivedAt,
      ledgerGroupName,
      ledgerApiUserId,
      artifactSchemaName,
      users: transformedUsers,
      artifacts: artifacts || [],
    };
  }

  // Get All Organizations
  async findAll(): Promise<OrganizationResponseDto[]> {
    const orgs = await this.organizationRepository.find({
      relations: ['memberships', 'memberships.user', 'artifacts'],
    });
    if (!orgs || orgs.length === 0)
      throw new BusinessLogicException(
        'There are no organizations in the database',
        BusinessError.NOT_FOUND,
      );
    return orgs.map((org) => this.transformToDto(org));
  }

  // Get One Organization
  async findOne(id: string): Promise<OrganizationResponseDto> {
    const organization: OrganizationEntity =
      await this.organizationRepository.findOne({
        where: { id },
        relations: ['memberships', 'memberships.user', 'artifacts'],
      });
    if (!organization)
      throw new BusinessLogicException(
        'The organization with the provided id does not exist',
        BusinessError.NOT_FOUND,
      );

    return this.transformToDto(organization);
  }

  // Create one organization
  async create(
    organization: OrganizationEntity,
  ): Promise<OrganizationResponseDto> {
    // Validate name
    if (!organization.name || organization.name.trim().length < 4) {
      throw new BusinessLogicException(
        'The name of the organization is required and must have at least 4 characters',
        BusinessError.BAD_REQUEST,
      );
    }

    // Validate description
    if (
      !organization.description ||
      organization.description.trim().length < 20
    ) {
      throw new BusinessLogicException(
        'The description is required and must be at least 20 characters long',
        BusinessError.BAD_REQUEST,
      );
    }

    if (organization.description.length > 250) {
      throw new BusinessLogicException(
        'The description cannot be longer than 250 characters',
        BusinessError.BAD_REQUEST,
      );
    }

    organization.status = OrganizationStatus.ACTIVE;
    organization.archivedAt = null;
    const savedOrg = await this.organizationRepository.save(organization);
    return this.transformToDto(savedOrg);
  }

  // Update
  async update(
    id: string,
    organization: Partial<OrganizationEntity>,
  ): Promise<OrganizationResponseDto> {
    // Find the organization by id
    const organizationToUpdate = await this.organizationRepository.findOne({
      where: { id },
      relations: ['memberships', 'memberships.user', 'artifacts'],
    });

    if (!organizationToUpdate) {
      throw new BusinessLogicException(
        'The organization with the provided id does not exist',
        BusinessError.NOT_FOUND,
      );
    }

    // Validate description length
    if (organization.description && organization.description.length > 250) {
      throw new BusinessLogicException(
        'The description cannot be longer than 250 characters',
        BusinessError.BAD_REQUEST,
      );
    }

    // description needs to be longer than 20 characters
    if (
      organization.description &&
      organization.description.trim().length < 20
    ) {
      throw new BusinessLogicException(
        'The description is required and must be at least 20 characters long',
        BusinessError.BAD_REQUEST,
      );
    }

    // Merge only the name and description fields
    this.organizationRepository.merge(organizationToUpdate, {
      name: organization.name,
      description: organization.description,
      slug: organization.slug,
      mspId: organization.mspId,
      ledgerGroupName: organization.ledgerGroupName,
      ledgerApiUserId: organization.ledgerApiUserId,
      artifactSchemaName: organization.artifactSchemaName,
    });

    // Save the updated entity
    const updatedOrg =
      await this.organizationRepository.save(organizationToUpdate);
    return this.transformToDto(updatedOrg);
  }

  // Delete

  async delete(id: string) {
    const organization: OrganizationEntity =
      await this.organizationRepository.findOne({ where: { id } });
    if (!organization)
      throw new BusinessLogicException(
        'The organization with the provided id does not exist',
        BusinessError.NOT_FOUND,
      );

    organization.status = OrganizationStatus.ARCHIVED;
    organization.archivedAt = new Date();
    await this.organizationRepository.save(organization);
  }

  // Delete all organizations
  async deleteAll() {
    const organizations = await this.organizationRepository.find();

    if (!organizations || organizations.length === 0) {
      throw new BusinessLogicException(
        'There are no organizations in the database',
        BusinessError.NOT_FOUND,
      );
    }

    await this.organizationRepository.update(
      { status: OrganizationStatus.ACTIVE },
      { status: OrganizationStatus.ARCHIVED, archivedAt: new Date() },
    );
  }
}
