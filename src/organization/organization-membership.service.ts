import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembershipEntity } from './organization-membership.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from '../user/user.entity';
import {
  CreateOrganizationMembershipDto,
  UpdateOrganizationMembershipDto,
} from './organization-membership.dto';
import { MembershipStatus, OrganizationStatus } from './membership-status.enum';

@Injectable()
export class OrganizationMembershipService {
  constructor(
    @InjectRepository(OrganizationMembershipEntity)
    private readonly membershipRepository: Repository<OrganizationMembershipEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizationRepository: Repository<OrganizationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async findByOrganization(organizationId: string): Promise<any[]> {
    const memberships = await this.membershipRepository.find({
      where: { organization: { id: organizationId } },
      relations: ['user', 'organization'],
      order: { createdAt: 'ASC' },
    });
    return memberships.map((membership) => this.toResponse(membership));
  }

  async create(
    organizationId: string,
    dto: CreateOrganizationMembershipDto,
  ): Promise<any> {
    const [organization, user, existing] = await Promise.all([
      this.organizationRepository.findOne({ where: { id: organizationId } }),
      this.userRepository.findOne({ where: { id: dto.userId } }),
      this.membershipRepository.findOne({
        where: {
          organization: { id: organizationId },
          user: { id: dto.userId },
        },
      }),
    ]);
    if (!organization || organization.status === OrganizationStatus.ARCHIVED) {
      throw new NotFoundException('Active organization not found');
    }
    if (!user) throw new NotFoundException('User not found');
    if (existing) {
      throw new BadRequestException('The user already has this membership');
    }

    return this.membershipRepository.manager.transaction(async (manager) => {
      const membership = manager.create(OrganizationMembershipEntity, {
        organization,
        user,
        roles: [...new Set(dto.roles)],
        status: MembershipStatus.ACTIVE,
        deactivatedAt: null,
      });
      const saved = await manager.save(
        OrganizationMembershipEntity,
        membership,
      );
      await manager.increment(UserEntity, { id: user.id }, 'authVersion', 1);
      return this.toResponse(saved);
    });
  }

  async update(
    organizationId: string,
    membershipId: string,
    dto: UpdateOrganizationMembershipDto,
  ): Promise<any> {
    const membership = await this.membershipRepository.findOne({
      where: {
        id: membershipId,
        organization: { id: organizationId },
      },
      relations: ['user', 'organization'],
    });
    if (!membership) throw new NotFoundException('Membership not found');

    if (dto.roles) membership.roles = [...new Set(dto.roles)];
    if (dto.status) {
      membership.status = dto.status;
      membership.deactivatedAt =
        dto.status === MembershipStatus.INACTIVE ? new Date() : null;
    }

    return this.membershipRepository.manager.transaction(async (manager) => {
      const saved = await manager.save(
        OrganizationMembershipEntity,
        membership,
      );
      await manager.increment(
        UserEntity,
        { id: membership.user.id },
        'authVersion',
        1,
      );
      return this.toResponse(saved);
    });
  }

  private toResponse(membership: OrganizationMembershipEntity) {
    return {
      id: membership.id,
      roles: membership.roles,
      status: membership.status,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      deactivatedAt: membership.deactivatedAt,
      user: membership.user
        ? {
            id: membership.user.id,
            name: membership.user.name,
            username: membership.user.username,
            email: membership.user.email,
          }
        : undefined,
      organization: membership.organization
        ? {
            id: membership.organization.id,
            name: membership.organization.name,
            slug: membership.organization.slug,
          }
        : undefined,
    };
  }
}
