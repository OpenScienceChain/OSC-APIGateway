import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import {
  MembershipStatus,
  OrganizationStatus,
} from '../../organization/membership-status.enum';
import { Role } from '../../shared/enums/role.enums';

describe('JwtStrategy', () => {
  const configService = {
    get: jest.fn((_key: string, defaultValue?: string) => defaultValue),
  } as any;
  const tokenBlacklist = {
    isBlacklisted: jest.fn(() => false),
  } as any;
  const userRepository = {
    findOne: jest.fn(),
  } as any;
  const membershipRepository = {
    findOne: jest.fn(),
  } as any;

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      configService,
      tokenBlacklist,
      userRepository,
      membershipRepository,
    );
  });

  const request = {
    headers: { authorization: 'Bearer signed-token' },
    get: (name: string) =>
      name.toLowerCase() === 'authorization'
        ? 'Bearer signed-token'
        : undefined,
  } as any;

  it('reloads membership roles and ignores forged token roles and MSP', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      username: 'researcher',
      email: 'researcher@example.org',
      authVersion: 4,
      platformAdmin: false,
    });
    membershipRepository.findOne.mockResolvedValue({
      id: 'membership-id',
      roles: [Role.COLLABORATOR],
      status: MembershipStatus.ACTIVE,
      organization: {
        id: 'nsg-id',
        name: 'nEUROSCIENCE GATEWAY',
        mspId: 'NSGMSP',
        status: OrganizationStatus.ACTIVE,
      },
    });

    const result = await strategy.validate(request, {
      sub: 'user-id',
      membershipId: 'membership-id',
      authVersion: 4,
      roles: [Role.ADMIN],
      organizationMspId: 'AttackerMSP',
    });

    expect(result.roles).toEqual([Role.COLLABORATOR]);
    expect(result.organizationMspId).toBe('NSGMSP');
    expect(membershipRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'membership-id',
          user: { id: 'user-id' },
        },
      }),
    );
  });

  it('rejects a stale token authorization version', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      authVersion: 5,
      platformAdmin: false,
    });

    await expect(
      strategy.validate(request, {
        sub: 'user-id',
        membershipId: 'membership-id',
        authVersion: 4,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive memberships', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      authVersion: 0,
      platformAdmin: false,
    });
    membershipRepository.findOne.mockResolvedValue({
      id: 'membership-id',
      status: MembershipStatus.INACTIVE,
      organization: { status: OrganizationStatus.ACTIVE },
    });

    await expect(
      strategy.validate(request, {
        sub: 'user-id',
        membershipId: 'membership-id',
        authVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
