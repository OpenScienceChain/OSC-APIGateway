import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmTestingConfig } from '../shared/testing-utils/typeorm-testing-config';
import { ArtifactService } from './artifact.service';
import { ArtifactEntity } from './artifact.entity';
import { faker } from '../shared/testing-utils/faker';
import { BusinessError } from '../shared/errors/business-errors';
import { SubmissionState } from './enums/submission-state.enum';
import { UpdateArtifactWorkerDto as UpdateArtifactDto } from './dto/update-artifact-worker.dto';
import { OrganizationEntity } from '../organization/organization.entity';
import { CreateArtifactDto } from './dto/create-artifact.dto';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { GhwService } from './ghw.service';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';

describe('ArtifactService', () => {
  let service: ArtifactService;
  let artifactRepository: Repository<ArtifactEntity>;
  let organizationRepository: Repository<OrganizationEntity>;
  let artifactList: ArtifactEntity[];
  let organization: OrganizationEntity;
  let rabbitMQService: RabbitMQService;
  let ghwService: GhwService;

  // Test submitter info
  const testSubmitter = {
    userId: '00000000-0000-4000-8000-000000000099',
    username: 'test_user',
    email: 'test@example.com',
  };

  // Helper function to generate a random artifact
  function generateRandomArtifact(): CreateArtifactDto {
    return {
      title: faker.commerce.productName(),
      description:
        faker.commerce.productDescription() +
        ' ' +
        faker.commerce.productDescription() +
        ' ' +
        faker.commerce.productDescription(),
      submission_comment:
        faker.lorem.sentence(8) + ' ' + faker.lorem.sentence(8),
      keywords: [faker.commerce.department(), faker.commerce.department()],
      links: [faker.internet.url()],
      dois: [],
      fundingAgencies: [],
      acknowledgements: faker.lorem.sentence(),
      manifest: [
        {
          hash: faker.string.alphanumeric(64),
          filename: faker.system.fileName(),
          algorithm: 'sha256',
        },
      ],
      footprint: faker.string
        .hexadecimal({ length: 64, prefix: '' })
        .toLowerCase(),
    };
  }

  // Helper function to generate a random organization
  const generateRandomOrganization = () => {
    return {
      name: faker.company.name(),
      description: faker.lorem.paragraph(),
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [...TypeOrmTestingConfig()],
      providers: [
        ArtifactService,
        {
          provide: RabbitMQService,
          useValue: {
            publishArtifactCreated: jest.fn().mockResolvedValue(undefined),
            publishArtifactSubmit: jest.fn().mockResolvedValue(undefined),
            publishArtifactUpdated: jest.fn().mockResolvedValue(undefined),
            publishArtifactUpdate: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GhwService,
          useValue: {
            fetchHistory: jest.fn().mockResolvedValue({ items: [] }),
            refresh: jest.fn().mockResolvedValue({ ok: true }),
          },
        },
      ],
    }).compile();

    service = module.get<ArtifactService>(ArtifactService);
    rabbitMQService = module.get<RabbitMQService>(RabbitMQService);
    ghwService = module.get<GhwService>(GhwService);
    artifactRepository = module.get<Repository<ArtifactEntity>>(
      getRepositoryToken(ArtifactEntity),
    );
    organizationRepository = module.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    await seedDatabase();
  });

  const seedDatabase = async () => {
    await artifactRepository.clear();
    await organizationRepository.clear();
    artifactList = [];

    // Create a single organization for testing
    const organizationData = generateRandomOrganization();
    organization = await organizationRepository.save(organizationData);

    // Create 5 artifacts for testing
    for (let i = 0; i < 5; i++) {
      const artifactDto = generateRandomArtifact();
      // Create the artifact directly to avoid calling service during test setup
      const artifact = artifactRepository.create({
        ...artifactDto,
        organization,
        submitterEmail: testSubmitter.email,
        submitterUsername: testSubmitter.username,
        submissionState: SubmissionState.PENDING,
        visibility: RecordVisibility.PUBLIC,
      });

      const savedArtifact = await artifactRepository.save(artifact);
      artifactList.push(savedArtifact);
    }

    return artifactList;
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // FIND ALL TESTS
  describe('findAll', () => {
    it('should return all artifacts as a flat array with minimal fields', async () => {
      const result = await service.findAll();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(artifactList.length);

      result.forEach((artifact) => {
        expect(artifact).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
          keywords: expect.any(Array),
          verified: expect.any(Boolean),
          footprint: expect.any(String),
        });
      });
    });

    it('should query all public artifacts across organizations', async () => {
      const spy = jest
        .spyOn(artifactRepository, 'find')
        .mockResolvedValueOnce([]);
      await service.findAll();
      expect(spy).toHaveBeenCalledWith({
        where: expect.objectContaining({
          visibility: RecordVisibility.PUBLIC,
          archivedAt: expect.anything(),
        }),
      });
    });

    it('should return an empty public list when no organization exists', async () => {
      await organizationRepository.clear();
      await expect(service.findAll()).resolves.toEqual([]);
    });

    it('shows private artifacts only to their owning organization', async () => {
      await artifactRepository.update(artifactList[0].id, {
        visibility: RecordVisibility.PRIVATE,
      });
      const anonymous = await service.findAll();
      const owner = await service.findAll(organization.id);
      expect(anonymous.map((artifact) => artifact.id)).not.toContain(
        artifactList[0].id,
      );
      expect(owner.map((artifact) => artifact.id)).toContain(
        artifactList[0].id,
      );
    });
  });

  // FIND ONE TESTS
  describe('findOne', () => {
    it('should return one artifact by id with all fields', async () => {
      const storedArtifact = artifactList[0];

      // Need to load the artifact with relations to get organization
      const fullArtifact = await artifactRepository.findOne({
        where: { id: storedArtifact.id },
        relations: ['organization'],
      });

      const artifact = await service.findOne(storedArtifact.id);
      expect(artifact).toBeDefined();
      expect(artifact.id).toEqual(fullArtifact.id);
      expect(artifact.title).toEqual(fullArtifact.title);
      expect(artifact.description).toEqual(fullArtifact.description);
      expect(artifact.footprint).toEqual(fullArtifact.footprint);
      expect(artifact.submitterEmail).toEqual(testSubmitter.email);
      expect(artifact.submitterUsername).toEqual(testSubmitter.username);
      expect(artifact.organization.name).toEqual(organization.name);
    });

    it('rejects a private artifact read from another organization', async () => {
      await artifactRepository.update(artifactList[0].id, {
        visibility: RecordVisibility.PRIVATE,
      });
      await expect(
        service.findOne(artifactList[0].id, faker.string.uuid()),
      ).rejects.toHaveProperty(
        'message',
        'The artifact is private to another organization',
      );
      await expect(
        service.findOne(artifactList[0].id, organization.id),
      ).resolves.toHaveProperty('id', artifactList[0].id);
    });

    it('should throw an exception for an invalid artifact ID', async () => {
      await expect(service.findOne('invalid-uuid')).rejects.toHaveProperty(
        'message',
        'The artifactId provided is not valid',
      );
    });

    it('should throw an exception for a non-existent artifact', async () => {
      const nonExistentId = faker.string.uuid();
      await expect(service.findOne(nonExistentId)).rejects.toHaveProperty(
        'message',
        'The artifact with the provided id does not exist',
      );
    });

    it('should report the artifact missing after its organization is deleted', async () => {
      // Save the ID first
      const artifactId = artifactList[0].id;

      // Clear the organization to test the case when no org exists
      await organizationRepository.clear();

      await expect(service.findOne(artifactId)).rejects.toHaveProperty(
        'message',
        'The artifact with the provided id does not exist',
      );
    });
  });

  // CREATE TESTS
  describe('create', () => {
    it('should create a new artifact with valid data', async () => {
      const artifactDto = generateRandomArtifact();

      const newArtifact = await service.create(artifactDto, testSubmitter);
      expect(newArtifact).toBeDefined();
      expect(newArtifact).toEqual({
        id: expect.any(String),
        title: artifactDto.title,
        description: artifactDto.description,
        keywords: artifactDto.keywords,
        submittedAt: expect.any(Date),
        verified: false,
        updatedAt: null,
        footprint: artifactDto.footprint,
        visibility: RecordVisibility.PRIVATE,
      });

      // Verify it's saved in the database
      const savedArtifact = await artifactRepository.findOne({
        where: { id: newArtifact.id },
        relations: ['organization'],
      });
      expect(savedArtifact).toBeDefined();
      expect(savedArtifact.submitterEmail).toBe(testSubmitter.email);
      expect(savedArtifact.submitterUsername).toBe(testSubmitter.username);
      expect(savedArtifact.organization.id).toBe(organization.id);
      expect(savedArtifact.visibility).toBe(RecordVisibility.PRIVATE);
    });

    it('should throw an exception for invalid email', async () => {
      const artifactDto = generateRandomArtifact();
      const invalidSubmitter = {
        username: 'testuser',
        email: 'invalid-email',
      };

      await expect(
        service.create(artifactDto, invalidSubmitter),
      ).rejects.toHaveProperty('message', 'Invalid submitter email provided.');
    });

    it('should throw an exception for empty username', async () => {
      const artifactDto = generateRandomArtifact();
      const invalidSubmitter = {
        username: '',
        email: 'valid@example.com',
      };

      await expect(
        service.create(artifactDto, invalidSubmitter),
      ).rejects.toHaveProperty(
        'message',
        'Invalid submitter username provided.',
      );
    });

    it('should throw an exception for short title', async () => {
      const artifactDto = generateRandomArtifact();
      artifactDto.title = 'Ab'; // Too short
      await expect(
        service.create(artifactDto, testSubmitter),
      ).rejects.toHaveProperty(
        'message',
        'The title of the artifact is required and must be at least 3 characters long',
      );
    });

    it('should throw an exception for short description', async () => {
      const artifactDto = generateRandomArtifact();
      artifactDto.description = 'Too short description';
      await expect(
        service.create(artifactDto, testSubmitter),
      ).rejects.toHaveProperty(
        'message',
        'The description must be at least 50 characters long',
      );
    });

    it('should throw an exception for existing title', async () => {
      // Use the title of an existing artifact
      const existingArtifact = artifactList[0];
      const artifactDto = generateRandomArtifact();
      artifactDto.title = existingArtifact.title;

      await expect(
        service.create(artifactDto, testSubmitter),
      ).rejects.toHaveProperty(
        'message',
        'An artifact with this title already exists in the organization',
      );
    });

    it('should throw an exception when no organization exists', async () => {
      // Clear the organization to test the case when no org exists
      await organizationRepository.clear();

      const artifactDto = generateRandomArtifact();
      await expect(
        service.create(artifactDto, testSubmitter),
      ).rejects.toHaveProperty(
        'message',
        'No organization exists in the system',
      );
    });

    // Additional CREATE tests for missing validation coverage
    describe('create - additional validation coverage', () => {
      it('should throw an exception for invalid footprint format', async () => {
        const artifactDto = generateRandomArtifact();
        artifactDto.footprint = 'abc';
        await expect(
          service.create(artifactDto, testSubmitter),
        ).rejects.toHaveProperty(
          'message',
          'A valid SHA-256 footprint hash is required (64 hex characters).',
        );
      });
      it('should throw an exception for keywords array exceeding 1000 characters', async () => {
        const artifactDto = generateRandomArtifact();
        // Create keywords that total over 1000 characters
        artifactDto.keywords = [
          'a'.repeat(500),
          'b'.repeat(501), // Total: 1001 characters
        ];

        await expect(
          service.create(artifactDto, testSubmitter),
        ).rejects.toHaveProperty(
          'message',
          'The keywords array can have at most 1000 characters in total',
        );
      });

      it('should throw an exception for links array exceeding 2000 characters', async () => {
        const artifactDto = generateRandomArtifact();
        // Create links that total over 2000 characters
        artifactDto.links = [
          'https://example.com/' + 'a'.repeat(1000),
          'https://test.com/' + 'b'.repeat(1000), // Total: over 2000 characters
        ];

        await expect(
          service.create(artifactDto, testSubmitter),
        ).rejects.toHaveProperty(
          'message',
          'The links array can have at most 2000 characters in total',
        );
      });

      it('should throw an exception for invalid URL in links array', async () => {
        const artifactDto = generateRandomArtifact();
        artifactDto.links = [
          'https://valid.com',
          'invalid-url',
          'https://another-valid.com',
        ];

        await expect(
          service.create(artifactDto, testSubmitter),
        ).rejects.toHaveProperty(
          'message',
          'Each link in the links array must be a valid URL',
        );
      });
    });

    it('should still resolve even if publishArtifactSubmit fails (logs error via logger)', async () => {
      const artifactDto = generateRandomArtifact();
      const publishSpy = jest
        .spyOn(rabbitMQService, 'publishArtifactSubmit')
        .mockRejectedValueOnce(new Error('broker down'));
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      const result = await service.create(artifactDto, testSubmitter);
      expect(result.id).toBeDefined();
      expect(publishSpy).toHaveBeenCalled();

      // Wait for the fire-and-forget rejection to propagate
      await new Promise((resolve) => setImmediate(resolve));

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish artifact.submit'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('broker down'),
      );
      loggerSpy.mockRestore();
    });

    it('should include correlationId in the published submit command when provided', async () => {
      const artifactDto = generateRandomArtifact();
      const publishSpy = jest.spyOn(rabbitMQService, 'publishArtifactSubmit');

      await service.create(artifactDto, testSubmitter, 'corr-xyz');

      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-xyz',
          request: expect.objectContaining({
            authenticatedUserId: testSubmitter.userId,
            organizationId: organization.id,
            operation: 'artifact.create',
          }),
        }),
      );
    });
  });

  // UPDATE TESTS
  describe('update', () => {
    it('should reject restricted fields in update', async () => {
      const storedArtifact = artifactList[0];
      const badDto: any = { title: 'New Title' };
      await expect(
        service.update(storedArtifact.id, badDto),
      ).rejects.toHaveProperty(
        'message',
        'Cannot update title, contributor, or submittedAt fields',
      );
    });

    it('should throw an exception for an invalid artifact ID', async () => {
      const badDto: any = { title: 'X' };
      await expect(
        service.update('invalid-uuid', badDto),
      ).rejects.toHaveProperty(
        'message',
        'The artifactId provided is not valid',
      );
    });

    it('should report the artifact missing after its organization is deleted', async () => {
      const artifactId = artifactList[0].id;
      await organizationRepository.clear();
      await expect(
        service.update(artifactId, {} as any),
      ).rejects.toHaveProperty(
        'message',
        'The artifact with the provided id does not exist',
      );
    });

    it('should save when patch is empty (no-op update)', async () => {
      const storedArtifact = artifactList[0];
      const saveSpy = jest.spyOn(artifactRepository, 'save');
      const updated = await service.update(storedArtifact.id, {} as any);
      expect(updated.id).toBe(storedArtifact.id);
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  // UPDATE USER TESTS
  describe('updateUser', () => {
    it('should persist user fields and publish artifact.update asynchronously', async () => {
      const storedArtifact = artifactList[0];
      const dto: any = {
        submission_comment:
          'Updating artifact details for traceability and audit purposes.',
        keywords: ['ai', 'ml'],
        footprint:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      };

      const saveSpy = jest.spyOn(artifactRepository, 'save');
      const publishSpy = jest.spyOn(rabbitMQService, 'publishArtifactUpdate');

      const result = await service.updateUser(
        storedArtifact.id,
        dto,
        undefined,
        undefined,
        undefined,
        testSubmitter.userId,
      );

      expect(result.id).toBe(storedArtifact.id);
      expect(result.submission_comment).toContain('Updating artifact details');
      expect(result.keywords).toEqual(['ai', 'ml']);
      expect(result.footprint).toEqual(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      );
      expect(saveSpy).toHaveBeenCalled();

      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: storedArtifact.id,
          patch: expect.objectContaining({
            keywords: ['ai', 'ml'],
            footprint:
              '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          }),
        }),
      );
    });

    it('should reject title or description in updateUser DTO', async () => {
      const storedArtifact = artifactList[0];
      await expect(
        service.updateUser(storedArtifact.id, { title: 'x' } as any),
      ).rejects.toHaveProperty('message', 'Cannot update title or description');
      await expect(
        service.updateUser(storedArtifact.id, { description: 'y' } as any),
      ).rejects.toHaveProperty('message', 'Cannot update title or description');
    });

    it('should log an error when publishArtifactUpdate rejects', async () => {
      const storedArtifact = artifactList[0];
      const dto: any = {
        submission_comment:
          'Updating artifact details for traceability and audit purposes.',
      };
      const publishError = new Error('broker unavailable');
      jest
        .spyOn(rabbitMQService, 'publishArtifactUpdate')
        .mockRejectedValueOnce(publishError);
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      await service.updateUser(
        storedArtifact.id,
        dto,
        undefined,
        undefined,
        undefined,
        testSubmitter.userId,
      );

      // Wait for the fire-and-forget rejection to propagate
      await new Promise((resolve) => setImmediate(resolve));

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to publish artifact.update for ${storedArtifact.id}`,
        ),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('broker unavailable'),
      );
      loggerSpy.mockRestore();
    });

    it('should include correlationId in the published update command when provided', async () => {
      const storedArtifact = artifactList[0];
      const dto: any = {
        submission_comment:
          'Updating artifact details for traceability and audit purposes.',
        keywords: ['physics'],
      };
      const publishSpy = jest.spyOn(rabbitMQService, 'publishArtifactUpdate');

      await service.updateUser(
        storedArtifact.id,
        dto,
        'user@example.com',
        'corr-abc',
        undefined,
        testSubmitter.userId,
      );

      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-abc',
          request: expect.objectContaining({
            authenticatedUserId: testSubmitter.userId,
            operation: 'artifact.update',
          }),
        }),
      );
    });
  });

  // DELETE TESTS
  describe('delete', () => {
    it('should archive an artifact without deleting provenance metadata', async () => {
      const storedArtifact = artifactList[0];
      await service.delete(storedArtifact.id);

      const archivedArtifact = await artifactRepository.findOne({
        where: { id: storedArtifact.id },
      });
      expect(archivedArtifact).not.toBeNull();
      expect(archivedArtifact.archivedAt).toBeInstanceOf(Date);
      expect(archivedArtifact.visibility).toBe(RecordVisibility.PRIVATE);
    });

    it('should throw an exception for an invalid artifact ID', async () => {
      await expect(service.delete('invalid-uuid')).rejects.toHaveProperty(
        'message',
        'The artifactId provided is not valid',
      );
    });

    it('should throw an exception for a non-existent artifact', async () => {
      const nonExistentId = faker.string.uuid();
      await expect(service.delete(nonExistentId)).rejects.toHaveProperty(
        'message',
        'The artifact with the provided id does not exist',
      );
    });

    it('should report the artifact missing after its organization is deleted', async () => {
      // Save the ID first
      const artifactId = artifactList[0].id;

      // Clear the organization to test the case when no org exists
      await organizationRepository.clear();

      await expect(service.delete(artifactId)).rejects.toHaveProperty(
        'message',
        'The artifact with the provided id does not exist',
      );
    });
  });

  // UPDATE WORKER TESTS
  describe('updateWorker - additional coverage for conditional updates', () => {
    it('should include nextOffset and pass correlationId to GHW history', async () => {
      const storedArtifact = artifactList[0];
      const spy = jest
        .spyOn(ghwService, 'fetchHistory')
        .mockResolvedValue({ items: [], hasMore: true } as any);
      const result = await service.getHistory(
        storedArtifact.id,
        { offset: '0', limit: '2', order: 'desc', includeValue: 'true' },
        'corr-123',
      );
      expect(spy).toHaveBeenCalledWith(
        {
          artifactId: storedArtifact.id.toLowerCase(),
          assetType: 'artifact',
          organizationId: storedArtifact.organization.id,
          offset: 0,
          limit: 2,
          order: 'desc',
          includeValue: true,
        },
        'corr-123',
      );
      expect((result as any).nextOffset).toBe(2);
    });

    it('should propagate timeout errors from GHW as gateway timeout', async () => {
      const storedArtifact = artifactList[0];
      jest
        .spyOn(ghwService, 'fetchHistory')
        .mockRejectedValueOnce(new Error('CONNECT_TIMEOUT'));
      await expect(
        service.getHistory(storedArtifact.id, {}, 'c'),
      ).rejects.toHaveProperty('type', BusinessError.GATEWAY_TIMEOUT);
    });

    it('should map upstream status code to BAD_GATEWAY', async () => {
      const storedArtifact = artifactList[0];
      const err: any = new Error('UPSTREAM_500');
      err.statusCode = 500;
      jest.spyOn(ghwService, 'fetchHistory').mockRejectedValueOnce(err);
      await expect(
        service.getHistory(storedArtifact.id, {}, 'c'),
      ).rejects.toHaveProperty('type', BusinessError.BAD_GATEWAY);
    });
    it('should accept only updatedAt in status update', async () => {
      const storedArtifact = artifactList[0];
      const updateStatusDto: UpdateArtifactDto = {
        updatedAt: '2025-01-01T00:00:00.000Z',
      } as any;
      const updatedArtifact = await service.updateWorker(
        storedArtifact.id,
        updateStatusDto,
      );
      expect(updatedArtifact.updatedAt).toBeDefined();
    });

    it('should not set updatedAt directly; it is managed by DB', async () => {
      const storedArtifact = artifactList[0];
      const updatedAt = '2023-12-07T15:30:00.000Z';
      const updateStatusDto: UpdateArtifactDto = {
        submissionState: SubmissionState.SUCCESS,
        updatedAt,
      };

      const updatedArtifact = await service.updateWorker(
        storedArtifact.id,
        updateStatusDto,
      );

      expect(updatedArtifact.updatedAt).toBeDefined();
    });

    it('should not update fields when they are null or empty string', async () => {
      const storedArtifact = artifactList[0];
      const updateStatusDto: UpdateArtifactDto = {
        blockchainTxId: '', // Empty string should not update
        peerId: null as any, // Null should not update
        submissionState: SubmissionState.SUCCESS,
      };

      const updatedArtifact = await service.updateWorker(
        storedArtifact.id,
        updateStatusDto,
      );

      expect(updatedArtifact.submissionState).toBe(SubmissionState.SUCCESS);
      // blockchainTxId and peerId should remain unchanged since they were empty/null
      expect(updatedArtifact.blockchainTxId).toEqual(
        storedArtifact.blockchainTxId,
      );
      expect(updatedArtifact.peerId).toEqual(storedArtifact.peerId);
    });

    it('should set submissionError on FAILED and not update updatedAt', async () => {
      const storedArtifact = artifactList[0];
      const originalUpdatedAt = storedArtifact.updatedAt;
      const err = 'bridge failed';
      const updateStatusDto: UpdateArtifactDto = {
        submissionState: SubmissionState.FAILED,
        updatedAt: '2025-01-01T00:00:00.000Z',
        submissionError: err,
      } as any;

      const updatedArtifact = await service.updateWorker(
        storedArtifact.id,
        updateStatusDto,
      );

      // On FAILED, we do not change updatedAt
      expect(updatedArtifact.updatedAt).toEqual(originalUpdatedAt);
      expect(updatedArtifact.submissionError).toContain(
        'Error updating the artifact. Details:',
      );
      expect(updatedArtifact.submissionError).toContain(err);
    });

    it('should clear previous submissionError on SUCCESS and update updatedAt', async () => {
      const storedArtifact = artifactList[0];
      // First mark as FAILED with an error
      const failDto: UpdateArtifactDto = {
        submissionState: SubmissionState.FAILED,
        updatedAt: '2025-01-01T00:00:00.000Z',
        submissionError: 'temporary outage',
      } as any;
      const failedArtifact = await service.updateWorker(
        storedArtifact.id,
        failDto,
      );
      expect(failedArtifact.submissionError).toContain(
        'Error updating the artifact',
      );

      // Then mark as SUCCESS with new updatedAt
      const successAt = '2025-01-02T00:00:00.000Z';
      const successDto: UpdateArtifactDto = {
        submissionState: SubmissionState.SUCCESS,
        updatedAt: successAt,
      } as any;
      const successArtifact = await service.updateWorker(
        storedArtifact.id,
        successDto,
      );
      expect(successArtifact.submissionError).toBeNull();
      expect(successArtifact.updatedAt).toEqual(new Date(successAt));
    });

    it('should prefix submission failure errors with submitting (no updatedAt)', async () => {
      const storedArtifact = artifactList[0];
      const err = 'submit failure';
      const updateStatusDto: UpdateArtifactDto = {
        submissionState: SubmissionState.FAILED,
        submissionError: err,
      } as any;

      const updatedArtifact = await service.updateWorker(
        storedArtifact.id,
        updateStatusDto,
      );

      expect(updatedArtifact.submissionError).toContain(
        'Error submitting the artifact. Details:',
      );
      expect(updatedArtifact.submissionError).toContain(err);
    });

    it('should reject unknown fields in status update', async () => {
      const storedArtifact = artifactList[0];
      const badDto: any = { title: 'nope' };
      await expect(
        service.updateWorker(storedArtifact.id, badDto),
      ).rejects.toHaveProperty('message');
    });

    it('should set blockchainTxId and peerId when provided', async () => {
      const storedArtifact = artifactList[0];
      const dto: UpdateArtifactDto = {
        blockchainTxId: '0xabc',
        peerId: 'peer-1',
      } as any;
      const updated = await service.updateWorker(storedArtifact.id, dto);
      expect(updated.blockchainTxId).toBe('0xabc');
      expect(updated.peerId).toBe('peer-1');
    });
  });

  // Refresh history tests to cover mapping and success
  describe('refreshHistory', () => {
    it('should call GHW refresh and return result', async () => {
      const storedArtifact = artifactList[0];
      const spy = jest
        .spyOn(ghwService, 'refresh')
        .mockResolvedValueOnce({ ok: true } as any);
      const out = await service.refreshHistory(storedArtifact.id, 'c-1');
      expect(spy).toHaveBeenCalled();
      expect(out).toEqual({ ok: true });
    });

    it('should map upstream timeout to GATEWAY_TIMEOUT', async () => {
      const storedArtifact = artifactList[0];
      jest
        .spyOn(ghwService, 'refresh')
        .mockRejectedValueOnce(new Error('CONNECT_TIMEOUT'));
      await expect(
        service.refreshHistory(storedArtifact.id, 'c'),
      ).rejects.toHaveProperty('type', BusinessError.GATEWAY_TIMEOUT);
    });

    it('should map upstream status code to BAD_GATEWAY for refresh', async () => {
      const storedArtifact = artifactList[0];
      const err: any = new Error('UPSTREAM_504');
      err.statusCode = 504;
      jest.spyOn(ghwService, 'refresh').mockRejectedValueOnce(err);
      await expect(
        service.refreshHistory(storedArtifact.id, 'c'),
      ).rejects.toHaveProperty('type', BusinessError.BAD_GATEWAY);
    });
  });
});
