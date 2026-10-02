import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/user.entity';
import { PasswordService } from './password.service';
import { TypeOrmTestingConfig } from '../shared/testing-utils/typeorm-testing-config';
import { faker } from '../shared/testing-utils/faker';
import { UserService } from '../user/user.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { Role } from '../shared/enums/role.enums';
import { MembershipStatus } from '../organization/membership-status.enum';

// Mock para UserService
class MockUserService {
  findOneForAuth = jest.fn();
  findOne = jest.fn();
}

// Mock para TokenBlacklistService
class MockTokenBlacklistService {
  blacklistToken = jest.fn();
  isBlacklisted = jest.fn().mockReturnValue(false);
  cleanupExpiredTokens = jest.fn();
  getBlacklistSize = jest.fn().mockReturnValue(0);
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
}

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let userRepository: Repository<UserEntity>;
  let passwordService: PasswordService;
  let userService: MockUserService;
  let tokenBlacklistService: MockTokenBlacklistService;
  let userList: UserEntity[];

  // Mock JWT service
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock.jwt.token'),
  };

  // Mock config service
  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
      const config = {
        JWT_SECRET: 'test-secret',
        JWT_EXPIRES_IN: '1h',
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [...TypeOrmTestingConfig()],
      providers: [
        AuthService,
        PasswordService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: UserService,
          useClass: MockUserService,
        },
        {
          provide: TokenBlacklistService,
          useClass: MockTokenBlacklistService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    passwordService = module.get<PasswordService>(PasswordService);
    userService = module.get<MockUserService>(UserService);
    tokenBlacklistService = module.get<MockTokenBlacklistService>(
      TokenBlacklistService,
    );

    await seedDatabase();
  });

  const seedDatabase = async () => {
    await userRepository.clear();
    userList = [];

    // Create 5 users for testing
    for (let i = 0; i < 5; i++) {
      const plainPassword = 'Password' + faker.number.int(10000);
      const hashedPassword = await passwordService.hashPassword(plainPassword);

      const user = {
        name: faker.person.fullName(),
        username: faker.internet.username() + faker.number.int(10000), // Ensure username is unique and long enough
        email: faker.internet.email(),
        password: hashedPassword,
        roles: [Role.COLLABORATOR], // Use Role enum instead of string
      };

      const savedUser = await userRepository.save(user);

      // Store the plain password for testing
      savedUser['plainPassword'] = plainPassword;
      userList.push(savedUser);
    }
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user object when credentials are valid', async () => {
      const mockUser = {
        id: 'user-id',
        username: 'testuser',
        email: 'testuser@example.org',
        password: 'hashedPassword',
        roles: [Role.COLLABORATOR],
        memberships: [
          {
            id: 'membership-id',
            status: MembershipStatus.ACTIVE,
            roles: [Role.COLLABORATOR],
            organization: {
              id: 'organization-id',
              name: 'nEUROSCIENCE GATEWAY',
              mspId: 'NSGMSP',
            },
          },
        ],
      };

      userService.findOneForAuth.mockResolvedValue(mockUser);
      passwordService.comparePasswords = jest.fn().mockResolvedValue(true);

      const result = await service.validateUser('testuser', 'password');

      expect(userService.findOneForAuth).toHaveBeenCalledWith('testuser');
      expect(result).toEqual({
        id: 'user-id',
        username: 'testuser',
        email: 'testuser@example.org',
        roles: [Role.COLLABORATOR],
        membershipId: 'membership-id',
        organizationId: 'organization-id',
        organizationName: 'nEUROSCIENCE GATEWAY',
        organizationMspId: 'NSGMSP',
        organization: {
          id: 'organization-id',
          name: 'nEUROSCIENCE GATEWAY',
          mspId: 'NSGMSP',
        },
        authVersion: 0,
        platformAdmin: false,
      });
    });

    it('requires explicit organization selection for multiple memberships', async () => {
      userService.findOneForAuth.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'testuser@example.org',
        password: 'hashedPassword',
        memberships: [
          {
            id: 'nsg-membership',
            status: MembershipStatus.ACTIVE,
            roles: [Role.PI],
            organization: { id: 'nsg', name: 'NSG' },
          },
          {
            id: 'citizen-membership',
            status: MembershipStatus.ACTIVE,
            roles: [Role.COLLABORATOR],
            organization: {
              id: 'citizen-science',
              name: 'Citizen Science',
            },
          },
        ],
      });
      passwordService.comparePasswords = jest.fn().mockResolvedValue(true);

      await expect(
        service.validateUser('testuser', 'password'),
      ).rejects.toHaveProperty(
        'message',
        'An active organization must be selected',
      );
      const selected = await service.validateUser(
        'testuser',
        'password',
        'citizen-science',
      );
      expect(selected.roles).toEqual([Role.COLLABORATOR]);
      expect(selected.organizationId).toBe('citizen-science');
    });

    it('should throw an exception when user is not found', async () => {
      userService.findOneForAuth.mockRejectedValue(new Error('User not found'));
      await expect(
        service.validateUser('nonexistent', 'password'),
      ).rejects.toHaveProperty('message', 'Invalid credentials');
    });

    it('should throw an exception when password is incorrect', async () => {
      userService.findOneForAuth.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        password: 'hashedPassword',
        roles: [Role.COLLABORATOR],
      });
      passwordService.comparePasswords = jest.fn().mockResolvedValue(false);
      await expect(
        service.validateUser('testuser', 'wrongPassword'),
      ).rejects.toHaveProperty('message', 'Invalid credentials');
    });
  });

  describe('login', () => {
    it('should return JWT token when login is successful', async () => {
      // Setup
      const req = {
        user: {
          id: userList[0].id,
          username: userList[0].username,
          roles: [Role.COLLABORATOR],
          email: userList[0].email,
          organizationId: null,
          organizationName: null,
          membershipId: null,
          organizationMspId: null,
          authVersion: 0,
          platformAdmin: false,
        },
      };

      // Execute
      const result = await service.login(req);

      // Assert
      expect(result).toBeDefined();
      expect(result.token).toBe('mock.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          username: userList[0].username,
          sub: userList[0].id,
          roles: [Role.COLLABORATOR],
          email: userList[0].email,
          organizationId: null,
          organizationName: null,
          membershipId: null,
          organizationMspId: null,
          authVersion: 0,
          platformAdmin: false,
        },
        {
          secret: 'test-secret',
          expiresIn: '1h',
        },
      );
    });
  });

  describe('logout', () => {
    it('should blacklist token and return success message', async () => {
      // Setup
      const token = 'Bearer mock.jwt.token';

      // Execute
      const result = await service.logout(token);

      // Assert
      expect(tokenBlacklistService.blacklistToken).toHaveBeenCalledWith(token);
      expect(result).toEqual({ message: 'Logout successful' });
    });
  });
});
