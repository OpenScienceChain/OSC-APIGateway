import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmTestingConfig } from '../shared/testing-utils/typeorm-testing-config';
import { OrganizationMembershipService } from './organization-membership.service';
import { OrganizationMembershipEntity } from './organization-membership.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from '../user/user.entity';
import { MembershipStatus, OrganizationStatus } from './membership-status.enum';
import { Role } from '../shared/enums/role.enums';

describe('OrganizationMembershipService', () => {
  let service: OrganizationMembershipService;
  let memberships: Repository<OrganizationMembershipEntity>;
  let organizations: Repository<OrganizationEntity>;
  let users: Repository<UserEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [...TypeOrmTestingConfig()],
      providers: [OrganizationMembershipService],
    }).compile();
    service = module.get(OrganizationMembershipService);
    memberships = module.get(getRepositoryToken(OrganizationMembershipEntity));
    organizations = module.get(getRepositoryToken(OrganizationEntity));
    users = module.get(getRepositoryToken(UserEntity));
  });

  async function seed() {
    const organization = await organizations.save({
      name: 'nEUROSCIENCE GATEWAY',
      description: 'A neuroscience research gateway organization.',
      slug: 'nsg',
      mspId: 'NSGMSP',
      status: OrganizationStatus.ACTIVE,
    });
    const user = await users.save({
      name: 'Research User',
      username: 'research-user',
      email: 'researcher@example.org',
      password: 'not-returned',
      roles: [Role.COLLABORATOR],
      authVersion: 0,
      platformAdmin: false,
    });
    return { organization, user };
  }

  it('creates a scoped membership and never returns the password', async () => {
    const { organization, user } = await seed();
    const result = await service.create(organization.id, {
      userId: user.id,
      roles: [Role.PI],
    });

    expect(result.organization.id).toBe(organization.id);
    expect(result.roles).toEqual([Role.PI]);
    expect(result.user.password).toBeUndefined();
    await expect(
      users.findOneByOrFail({ id: user.id }),
    ).resolves.toHaveProperty('authVersion', 1);
  });

  it('deactivates a membership and invalidates existing tokens', async () => {
    const { organization, user } = await seed();
    const membership = await memberships.save({
      organization,
      user,
      roles: [Role.COLLABORATOR],
      status: MembershipStatus.ACTIVE,
      deactivatedAt: null,
    });

    const result = await service.update(organization.id, membership.id, {
      status: MembershipStatus.INACTIVE,
    });

    expect(result.status).toBe(MembershipStatus.INACTIVE);
    expect(result.deactivatedAt).toBeInstanceOf(Date);
    await expect(
      users.findOneByOrFail({ id: user.id }),
    ).resolves.toHaveProperty('authVersion', 1);
  });

  it('does not create memberships for archived organizations', async () => {
    const { organization, user } = await seed();
    await organizations.update(organization.id, {
      status: OrganizationStatus.ARCHIVED,
      archivedAt: new Date(),
    });

    await expect(
      service.create(organization.id, {
        userId: user.id,
        roles: [Role.COLLABORATOR],
      }),
    ).rejects.toHaveProperty('message', 'Active organization not found');
  });
});
