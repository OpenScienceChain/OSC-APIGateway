import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { TypeOrmTestingConfig } from '../shared/testing-utils/typeorm-testing-config';
import { faker } from '../shared/testing-utils/faker';
import { UserCreateDto } from './dto/userCreate.dto';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../auth/password.service';
import { Role } from '../shared/enums/role.enums';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserUpdateDto } from './dto/user-update.dto';
import { OrganizationEntity } from '../organization/organization.entity';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';
import { MembershipStatus } from '../organization/membership-status.enum';

describe('UserService', () => {
  let service: UserService;
  let repository: Repository<UserEntity>;
  let userList: UserEntity[];
  let configService: ConfigService;
  let passwordService: PasswordService;
  let organizationRepository: Repository<OrganizationEntity>;
  let membershipRepository: Repository<OrganizationMembershipEntity>;

  // Mock config service
  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config = {
        ADMIN1_USERNAME: 'admin',
        ADMIN1_PASSWORD: 'securePassword123',
        ADMIN1_ROLES: 'admin',
        ADMIN2_USERNAME: 'superadmin',
        ADMIN2_PASSWORD: 'superSecurePassword456',
        ADMIN2_ROLES: 'admin,pi',
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [...TypeOrmTestingConfig()],
      providers: [
        UserService,
        PasswordService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    organizationRepository = module.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    membershipRepository = module.get<Repository<OrganizationMembershipEntity>>(
      getRepositoryToken(OrganizationMembershipEntity),
    );
    configService = module.get<ConfigService>(ConfigService);
    passwordService = module.get<PasswordService>(PasswordService);

    await seedDatabase();
  });

  const seedDatabase = async () => {
    await membershipRepository.clear();
    await repository.clear();
    userList = [];

    // Create a test organization
    const organization = organizationRepository.create({
      name: 'Test Organization',
      description: 'Test Description',
    });
    await organizationRepository.save(organization);

    // Create 5 users for testing
    for (let i = 0; i < 5; i++) {
      const user = {
        name: faker.person.fullName(),
        username: `testuser${i}_${faker.number.int(10000)}`, // Garantizar que el username tenga al menos 8 caracteres
        email: faker.internet.email(),
        password: await passwordService.hashPassword(
          'Password' + faker.number.int(10000),
        ),
        roles: [Role.COLLABORATOR],
        organization: organization,
      };

      const savedUser = await repository.save(user);
      await membershipRepository.save({
        user: savedUser,
        organization,
        roles: [Role.COLLABORATOR],
        status: MembershipStatus.ACTIVE,
        deactivatedAt: null,
      });
      userList.push(savedUser);
    }
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('loadUsersFromEnv', () => {
    it('should save admin users to the database', async () => {
      // Clear admin users from database
      await repository.delete({ username: 'admin' });
      await repository.delete({ username: 'superadmin' });

      // Call the method directly
      await service.loadUsersFromEnv();

      // Verify directly in the database that users were saved
      const adminUser = await repository.findOne({
        where: { username: 'admin' },
      });
      const superadminUser = await repository.findOne({
        where: { username: 'superadmin' },
      });

      // Verify they exist
      expect(adminUser).toBeDefined();
      expect(superadminUser).toBeDefined();

      // Verify admin user properties
      expect(adminUser.name).toBe('admin');
      expect(adminUser.email).toBe('admin@example.com');
      expect(adminUser.roles).toEqual([Role.ADMIN]);

      // Verify superadmin user properties
      expect(superadminUser.name).toBe('superadmin');
      expect(superadminUser.email).toBe('superadmin@example.com');
      expect(superadminUser.roles).toEqual([Role.ADMIN, Role.PI]);
    });

    it('should keep bootstrap users stable across application restarts', async () => {
      await repository.delete({ username: 'admin' });
      await repository.delete({ username: 'superadmin' });

      await service.loadUsersFromEnv();
      const originalAdmin = await repository.findOne({
        where: { username: 'admin' },
      });

      await service.loadUsersFromEnv();
      const admins = await repository.find({
        where: [{ username: 'admin' }, { username: 'superadmin' }],
      });
      const restartedAdmin = admins.find((user) => user.username === 'admin');

      expect(admins).toHaveLength(2);
      expect(restartedAdmin.id).toBe(originalAdmin.id);
      expect(restartedAdmin.password).toBe(originalAdmin.password);
    });

    it('should throw an error when no users are found in environment variables', async () => {
      // Mock the ConfigService to return undefined values
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      // Clear any existing users
      (service as any).users = [];

      // Call loadUsersFromEnv and expect it to throw
      await expect(service.loadUsersFromEnv()).rejects.toThrow(
        /No users found in environment variables/,
      );
    });
  });

  describe('findOneForAuth', () => {
    it('should return a user with password for authentication', async () => {
      const storedUser = userList[0];
      const result = await service.findOneForAuth(storedUser.username);

      expect(result).toBeDefined();
      expect(result.username).toEqual(storedUser.username);
      expect(result.password).toBeDefined();
    });

    it('should throw BusinessLogicException when user not found', async () => {
      repository.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.findOneForAuth('nonexistentuser'),
      ).rejects.toHaveProperty('message', 'User not found');
    });
  });

  describe('findOne', () => {
    it('should return a user DTO by username', async () => {
      const storedUser = userList[0];
      const result = await service.findOne(storedUser.username);

      expect(result).toBeDefined();
      expect(result.username).toEqual(storedUser.username);
      // Don't check for instance type as it might be transformed
      expect((result as any).password).toBeUndefined();
    });

    it('should throw BusinessLogicException when user not found', async () => {
      repository.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.findOne('nonexistentuser')).rejects.toHaveProperty(
        'message',
        'User not found',
      );
    });
  });

  describe('create', () => {
    it('should create a new user with COLLABORATOR role', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'collaborator123'; // Usar un nombre de usuario fijo que cumpla con la validación
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      const result = await service.create(createUserDto, creator);

      expect(result).toBeDefined();
      expect(result.username).toEqual(createUserDto.username);
      expect(result.roles).toEqual([Role.COLLABORATOR]);
      expect((result as any).password).toBeUndefined();
    });

    it('should throw BadRequestException when user already exists', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = userList[0].username; // Use existing username
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(service.create(createUserDto, creator)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when password is too short', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'validusername123'; // Usar un nombre de usuario fijo que cumpla con la validación
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'short'; // Too short
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(service.create(createUserDto, creator)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when PI tries to create ADMIN user', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'adminattempt123'; // Usar un nombre de usuario fijo que cumpla con la validación
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.ADMIN; // PI trying to create ADMIN

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(service.create(createUserDto, creator)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when no organization exists for non-admin user', async () => {
      // Clear both repositories to ensure no organizations exist
      await repository.clear();
      await organizationRepository.clear();

      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'validusername123'; // Asegurar que tiene al menos 8 caracteres
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      const creator = await repository.save({
        id: faker.string.uuid(),
        name: 'PI User',
        username: 'piuser123', // Asegurar que tiene al menos 8 caracteres
        email: 'pi@example.com',
        password: 'hashedpassword',
        roles: [Role.PI],
      });

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Users can only be created in the active organization',
      );
    });

    it('should create an organization-scoped admin membership', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'adminusername123'; // Usar un username fijo que cumpla con la validación de longitud
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.ADMIN;

      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.ADMIN];
      creator.organization = userList[0].organization;

      const result = await service.create(createUserDto, creator);
      expect(result).toBeDefined();
      expect(result.roles).toContain(Role.ADMIN);
      expect(result.organizationName).toBe('Test Organization');
    });

    it('rejects an organization admin creating a user in another organization', async () => {
      const otherOrganization = await organizationRepository.save(
        organizationRepository.create({
          name: 'Other Organization',
          description: 'Other organization for scope testing',
        }),
      );
      const createUserDto = new UserCreateDto();
      createUserDto.name = 'Other Admin';
      createUserDto.username = 'otheradmin123';
      createUserDto.email = 'other-admin@example.com';
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.ADMIN;
      createUserDto.organizationId = otherOrganization.id;

      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.ADMIN];
      creator.organization = userList[0].organization;

      await expect(service.create(createUserDto, creator)).rejects.toThrow(
        BadRequestException,
      );
      expect(
        await repository.findOne({ where: { username: 'otheradmin123' } }),
      ).toBeNull();

      creator.platformAdmin = true;
      const created = await service.create(createUserDto, creator);
      expect(created.organizationId).toBe(otherOrganization.id);
    });

    it('should throw BadRequestException if creator is not an admin or PI', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'validusername123'; // Asegurar que tiene al menos 8 caracteres
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.COLLABORATOR];

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Only admins and PIs can create users',
      );
    });

    it('should throw BadRequestException when username is too short', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'short'; // Too short (less than 8 characters)
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Username must be between 8 and 50 characters long',
      );
    });

    it('should throw BadRequestException when username is too long', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      // Create a username that is longer than 50 characters
      createUserDto.username = 'a'.repeat(51);
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Username must be between 8 and 50 characters long',
      );
    });

    it('should throw BadRequestException when email is invalid', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = faker.person.fullName();
      createUserDto.username = 'validusername123';
      createUserDto.email = 'invalid-email'; // Invalid email format
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Email must be a valid email address',
      );
    });

    it('should throw BadRequestException when name is too short', async () => {
      const createUserDto = new UserCreateDto();
      createUserDto.name = 'AB'; // Too short (less than 3 characters)
      createUserDto.username = 'validusername123';
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Name must be between 3 and 50 characters long',
      );
    });

    it('should throw BadRequestException when name is too long', async () => {
      const createUserDto = new UserCreateDto();
      // Create a name that is longer than 50 characters
      createUserDto.name = 'a'.repeat(51);
      createUserDto.username = 'validusername123';
      createUserDto.email = faker.internet.email();
      createUserDto.password = 'Password123!';
      createUserDto.role = Role.COLLABORATOR;

      // Get the test organization
      const organization = await organizationRepository.findOne({
        where: { name: 'Test Organization' },
      });

      // Create a PI user as the creator
      const creator = new UserEntity();
      creator.id = faker.string.uuid();
      creator.roles = [Role.PI];
      creator.organization = organization;

      await expect(
        service.create(createUserDto, creator),
      ).rejects.toHaveProperty(
        'message',
        'Name must be between 3 and 50 characters long',
      );
    });
  });

  describe('findAll', () => {
    it('should return an array of user DTOs', async () => {
      const result = await service.findAll();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect((result[0] as any).password).toBeUndefined();
    });

    it('should handle empty user list', async () => {
      await repository.clear();
      const result = await service.findAll();
      expect(result).toBeDefined();
      expect(result).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update a user', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.name = 'Updated Name';

      // Create an admin user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.name = 'Admin User';
      currentUser.username = 'adminuser';
      currentUser.email = 'admin@example.com';
      currentUser.password = 'hashedpassword';
      currentUser.organization = userToUpdate.organization;

      const result = await service.update(
        userToUpdate.id,
        updateUserDto,
        currentUser,
      );

      expect(result).toBeDefined();
      expect(result.name).toEqual('Updated Name');
      expect((result as any).password).toBeUndefined();
    });

    it('rejects a cross-organization password reset by an organization admin', async () => {
      const otherOrganization = await organizationRepository.save(
        organizationRepository.create({
          name: 'Other Organization',
          description: 'Other organization for scope testing',
        }),
      );
      const target = await repository.save({
        name: 'Other User',
        username: 'otheruser123',
        email: 'other-user@example.com',
        password: 'original-hash',
        roles: [Role.COLLABORATOR],
        organization: otherOrganization,
      });
      const admin = new UserEntity();
      admin.id = faker.string.uuid();
      admin.roles = [Role.ADMIN];
      admin.organization = userList[0].organization;
      const update = new UserUpdateDto();
      update.password = 'NewPassword123!';

      await expect(service.update(target.id, update, admin)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(
        (await repository.findOneByOrFail({ id: target.id })).password,
      ).toBe('original-hash');

      admin.platformAdmin = true;
      const result = await service.update(target.id, update, admin);
      expect((result as any).requiresRelogin).toBe(true);
    });

    it('should throw NotFoundException when user not found', async () => {
      const updateUserDto = new UserUpdateDto();
      updateUserDto.name = 'Updated Name';

      // Create an admin user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.name = 'Admin User';
      currentUser.username = 'adminuser';
      currentUser.email = 'admin@example.com';
      currentUser.password = 'hashedpassword';

      await expect(
        service.update('nonexistentid', updateUserDto, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException when non-admin tries to update admin user', async () => {
      // Create an admin user
      const adminUser = new UserEntity();
      adminUser.id = faker.string.uuid();
      adminUser.roles = [Role.ADMIN];
      adminUser.name = 'Admin User';
      adminUser.username = 'adminuser';
      adminUser.email = 'admin@example.com';
      adminUser.password = 'hashedpassword';
      const savedAdmin = await repository.save(adminUser);

      const updateUserDto = new UserUpdateDto();
      updateUserDto.name = 'Updated Name';

      // Create a PI user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.PI];
      currentUser.name = 'PI User';
      currentUser.username = 'piuser';
      currentUser.email = 'pi@example.com';
      currentUser.password = 'hashedpassword';

      await expect(
        service.update(savedAdmin.id, updateUserDto, currentUser),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should allow self-update of non-sensitive fields', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.name = 'Updated Name';

      const result = await service.update(
        userToUpdate.id,
        updateUserDto,
        userToUpdate,
      );

      expect(result).toBeDefined();
      expect(result.name).toEqual('Updated Name');
    });

    it('should throw BadRequestException when trying to update to existing username', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.username = userList[1].username;

      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.organization = userToUpdate.organization;

      await expect(
        service.update(userToUpdate.id, updateUserDto, currentUser),
      ).rejects.toHaveProperty('message', 'Username already exists');
    });

    it('should throw BadRequestException when trying to update to existing email', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.email = userList[1].email;

      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.organization = userToUpdate.organization;

      await expect(
        service.update(userToUpdate.id, updateUserDto, currentUser),
      ).rejects.toHaveProperty('message', 'Email already exists');
    });

    it('should throw BadRequestException when password is too short', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.password = 'short';

      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.organization = userToUpdate.organization;

      await expect(
        service.update(userToUpdate.id, updateUserDto, currentUser),
      ).rejects.toHaveProperty(
        'message',
        'Password must be at least 8 characters long',
      );
    });

    it('should throw UnauthorizedException when non-admin tries to update roles', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.role = Role.ADMIN;

      const currentUser = new UserEntity();
      currentUser.id = userToUpdate.id;
      currentUser.roles = [Role.COLLABORATOR];

      await expect(
        service.update(userToUpdate.id, updateUserDto, currentUser),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when admin tries to change their own email', async () => {
      let adminUser = userList.find((user) => user.roles.includes(Role.ADMIN));
      if (!adminUser) {
        // Create an admin if none exists
        const newAdmin = new UserEntity();
        newAdmin.id = faker.string.uuid();
        newAdmin.name = 'Admin User';
        newAdmin.username = 'adminuser';
        newAdmin.email = 'admin@example.com';
        newAdmin.password = 'hashedpassword';
        newAdmin.roles = [Role.ADMIN];
        await repository.save(newAdmin);
        adminUser = newAdmin;
      }

      const updateUserDto = new UserUpdateDto();
      updateUserDto.email = 'new-email@example.com';

      await expect(
        service.update(adminUser.id, updateUserDto, adminUser),
      ).rejects.toHaveProperty(
        'message',
        'Admins cannot change their own email',
      );
    });

    it('should throw UnauthorizedException when admin tries to change their own username', async () => {
      let adminUser = userList.find((user) => user.roles.includes(Role.ADMIN));
      if (!adminUser) {
        // Create an admin if none exists
        const newAdmin = new UserEntity();
        newAdmin.id = faker.string.uuid();
        newAdmin.name = 'Admin User';
        newAdmin.username = 'adminuser';
        newAdmin.email = 'admin@example.com';
        newAdmin.password = 'hashedpassword';
        newAdmin.roles = [Role.ADMIN];
        await repository.save(newAdmin);
        adminUser = newAdmin;
      }

      const updateUserDto = new UserUpdateDto();
      updateUserDto.username = 'new-username';

      await expect(
        service.update(adminUser.id, updateUserDto, adminUser),
      ).rejects.toHaveProperty(
        'message',
        'Admins cannot change their own username',
      );
    });

    it('should return requiresRelogin flag when password is updated', async () => {
      const userToUpdate = userList[0];
      const updateUserDto = new UserUpdateDto();
      updateUserDto.password = 'NewPassword123!';

      const admin =
        userList.find((user) => user.roles.includes(Role.ADMIN)) ||
        (await repository.save({
          id: faker.string.uuid(),
          name: 'Admin User',
          username: 'adminuser',
          email: 'admin@example.com',
          password: 'hashedpassword',
          roles: [Role.ADMIN],
          organization: userToUpdate.organization,
        }));

      admin.organization = userToUpdate.organization;

      const result = await service.update(
        userToUpdate.id,
        updateUserDto,
        admin,
      );

      expect(result).toBeDefined();
      expect((result as any).requiresRelogin).toBe(true);
    });
  });

  describe('remove', () => {
    it('should deactivate an organization membership without deleting the user', async () => {
      const userToRemove = userList[0];

      // Create an admin user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.name = 'Admin User';
      currentUser.username = 'adminuser';
      currentUser.email = 'admin@example.com';
      currentUser.password = 'hashedpassword';
      currentUser.organization = userToRemove.organization;

      await service.remove(userToRemove.id, currentUser);

      const retainedUser = await repository.findOne({
        where: { id: userToRemove.id },
      });
      expect(retainedUser).not.toBeNull();
      const membership = await membershipRepository.findOne({
        where: {
          user: { id: userToRemove.id },
          organization: { id: userToRemove.organization.id },
        },
      });
      expect(membership.status).toBe(MembershipStatus.INACTIVE);
    });

    it('should throw NotFoundException when user not found', async () => {
      // Create an admin user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.name = 'Admin User';
      currentUser.username = 'adminuser';
      currentUser.email = 'admin@example.com';
      currentUser.password = 'hashedpassword';

      await expect(
        service.remove('nonexistentid', currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when PI tries to remove admin user', async () => {
      // Create an admin user
      const adminUser = new UserEntity();
      adminUser.id = faker.string.uuid();
      adminUser.roles = [Role.ADMIN];
      adminUser.name = 'Admin User';
      adminUser.username = 'adminuser';
      adminUser.email = 'admin@example.com';
      adminUser.password = 'hashedpassword';
      const savedAdmin = await repository.save(adminUser);

      // Create a PI user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.PI];
      currentUser.name = 'PI User';
      currentUser.username = 'piuser';
      currentUser.email = 'pi@example.com';
      currentUser.password = 'hashedpassword';

      await expect(service.remove(savedAdmin.id, currentUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when admin tries to remove another admin', async () => {
      // Create an admin user
      const adminUser = new UserEntity();
      adminUser.id = faker.string.uuid();
      adminUser.roles = [Role.ADMIN];
      adminUser.name = 'Admin User';
      adminUser.username = 'adminuser';
      adminUser.email = 'admin@example.com';
      adminUser.password = 'hashedpassword';
      const savedAdmin = await repository.save(adminUser);

      // Create another admin user as the current user
      const currentUser = new UserEntity();
      currentUser.id = faker.string.uuid();
      currentUser.roles = [Role.ADMIN];
      currentUser.name = 'Admin User 2';
      currentUser.username = 'adminuser2';
      currentUser.email = 'admin2@example.com';
      currentUser.password = 'hashedpassword';

      await expect(service.remove(savedAdmin.id, currentUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when PI tries to delete non-COLLABORATOR user', async () => {
      // Create a PI user
      const piUser = await repository.save({
        id: faker.string.uuid(),
        name: 'PI User',
        username: 'piuser',
        email: 'pi@example.com',
        password: 'hashedpassword',
        roles: [Role.PI],
        organization: userList[0].organization,
      });
      await membershipRepository.save({
        user: piUser,
        organization: userList[0].organization,
        roles: [Role.PI],
        status: MembershipStatus.ACTIVE,
        deactivatedAt: null,
      });

      // Create a PI user to delete (PI can't delete other PIs)
      const userToDelete = await repository.save({
        id: faker.string.uuid(),
        name: 'Another PI',
        username: 'anotherpi',
        email: 'anotherpi@example.com',
        password: 'hashedpassword',
        roles: [Role.PI],
        organization: userList[0].organization,
      });
      await membershipRepository.save({
        user: userToDelete,
        organization: userList[0].organization,
        roles: [Role.PI],
        status: MembershipStatus.ACTIVE,
        deactivatedAt: null,
      });

      await expect(
        service.remove(userToDelete.id, piUser),
      ).rejects.toHaveProperty(
        'message',
        'PI can only delete users with role COLLABORATOR',
      );
    });
  });

  describe('findOneById', () => {
    it('should return a user DTO by id', async () => {
      const storedUser = userList[0];
      const result = await service.findOneById(storedUser.id);

      expect(result).toBeDefined();
      expect(result.id).toEqual(storedUser.id);
      expect((result as any).password).toBeUndefined();
    });

    it('should throw NotFoundException when user not found', async () => {
      await expect(service.findOneById('nonexistentid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle malformed UUID', async () => {
      await expect(service.findOneById('not-a-uuid')).rejects.toThrow();
    });
  });

  describe('onModuleInit', () => {
    it('should call loadUsersFromEnv on module initialization', async () => {
      // Mock the loadUsersFromEnv method
      const loadUsersSpy = jest
        .spyOn(service, 'loadUsersFromEnv')
        .mockResolvedValue();

      // Call onModuleInit
      await service.onModuleInit();

      // Verify that loadUsersFromEnv was called
      expect(loadUsersSpy).toHaveBeenCalled();
    });
  });
});
