import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TypeOrmTestingConfig } from '../shared/testing-utils/typeorm-testing-config';
import { WorkflowService } from './workflow.service';
import { WorkflowEntity } from './workflow.entity';
import { ArtifactEntity } from '../artifact/artifact.entity';
import { OrganizationEntity } from '../organization/organization.entity';
import { faker } from '../shared/testing-utils/faker';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { RabbitMQService } from '../messaging/rabbitmq.service';
import { RecordVisibility } from '../shared/enums/record-visibility.enum';

describe('WorkflowService', () => {
  let service: WorkflowService;
  let workflowRepository: Repository<WorkflowEntity>;
  let artifactRepository: Repository<ArtifactEntity>;
  let organizationRepository: Repository<OrganizationEntity>;
  let workflowList: WorkflowEntity[];
  let organization: OrganizationEntity;
  let testArtifacts: ArtifactEntity[];
  let rabbitMQService: RabbitMQService;

  const testSubmitter = {
    userId: '00000000-0000-4000-8000-000000000099',
    username: 'test_user',
    email: 'test@example.com',
  };

  function generateRandomWorkflow(): CreateWorkflowDto {
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
      githubRepositories: [
        {
          url: faker.internet.url(),
          description: faker.lorem.sentence(),
          gitHash: faker.string.alphanumeric(40),
          contents: [
            {
              filename: faker.system.fileName(),
              hash: faker.string.alphanumeric(40),
            },
          ],
        },
      ],
      artifactIds: [],
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [...TypeOrmTestingConfig()],
      providers: [
        WorkflowService,
        {
          provide: RabbitMQService,
          useValue: {
            publishWorkflowSubmit: jest.fn().mockResolvedValue(undefined),
            publishWorkflowUpdate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
    rabbitMQService = module.get<RabbitMQService>(RabbitMQService);
    workflowRepository = module.get<Repository<WorkflowEntity>>(
      getRepositoryToken(WorkflowEntity),
    );
    artifactRepository = module.get<Repository<ArtifactEntity>>(
      getRepositoryToken(ArtifactEntity),
    );
    organizationRepository = module.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    await seedDatabase();
  });

  const seedDatabase = async () => {
    await workflowRepository.clear();
    await artifactRepository.clear();
    await organizationRepository.clear();
    workflowList = [];
    testArtifacts = [];

    organization = await organizationRepository.save({
      name: faker.company.name(),
      description: faker.lorem.paragraph(),
    });

    // Create test artifacts
    for (let i = 0; i < 3; i++) {
      const artifact = artifactRepository.create({
        title: faker.commerce.productName(),
        description:
          faker.commerce.productDescription() +
          ' ' +
          faker.commerce.productDescription() +
          ' ' +
          faker.commerce.productDescription(),
        submission_comment:
          faker.lorem.sentence(8) + ' ' + faker.lorem.sentence(8),
        keywords: [faker.commerce.department()],
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
        organization,
        submitterEmail: testSubmitter.email,
        submitterUsername: testSubmitter.username,
        submissionState: SubmissionState.SUCCESS,
        visibility: RecordVisibility.PUBLIC,
      });
      testArtifacts.push(await artifactRepository.save(artifact));
    }

    // Create test workflows
    for (let i = 0; i < 3; i++) {
      const workflow = workflowRepository.create({
        title: faker.commerce.productName() + ` ${i}`,
        description:
          faker.commerce.productDescription() +
          ' ' +
          faker.commerce.productDescription() +
          ' ' +
          faker.commerce.productDescription(),
        submission_comment:
          faker.lorem.sentence(8) + ' ' + faker.lorem.sentence(8),
        keywords: [faker.commerce.department()],
        githubRepositories: [],
        organization,
        artifacts: [testArtifacts[0]],
        submitterEmail: testSubmitter.email,
        submitterUsername: testSubmitter.username,
        submissionState: SubmissionState.PENDING,
        submittedAt: new Date(),
        visibility: RecordVisibility.PUBLIC,
      });
      workflowList.push(await workflowRepository.save(workflow));
    }
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all workflows with minimal fields', async () => {
      const result = await service.findAll();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(workflowList.length);
      result.forEach((w) => {
        expect(w).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
          description: expect.any(String),
        });
      });
    });

    it('should return an empty public list when no organization exists', async () => {
      await organizationRepository.clear();
      await expect(service.findAll()).resolves.toEqual([]);
    });

    it('shows private workflows only to their owning organization', async () => {
      await workflowRepository.update(workflowList[0].id, {
        visibility: RecordVisibility.PRIVATE,
      });
      const anonymous = await service.findAll();
      const owner = await service.findAll(organization.id);
      expect(anonymous.map((workflow) => workflow.id)).not.toContain(
        workflowList[0].id,
      );
      expect(owner.map((workflow) => workflow.id)).toContain(
        workflowList[0].id,
      );
    });
  });

  describe('findOne', () => {
    it('should return a workflow by id with artifacts populated', async () => {
      const stored = workflowList[0];
      const result = await service.findOne(stored.id);
      expect(result).toBeDefined();
      expect(result.id).toEqual(stored.id);
      expect(result.title).toEqual(stored.title);
      expect(result.artifacts).toBeDefined();
      expect(Array.isArray(result.artifacts)).toBe(true);
    });

    it('rejects a private workflow read from another organization', async () => {
      await workflowRepository.update(workflowList[0].id, {
        visibility: RecordVisibility.PRIVATE,
      });
      await expect(
        service.findOne(workflowList[0].id, faker.string.uuid()),
      ).rejects.toHaveProperty(
        'message',
        'The workflow is private to another organization',
      );
      await expect(
        service.findOne(workflowList[0].id, organization.id),
      ).resolves.toHaveProperty('id', workflowList[0].id);
    });

    it('should throw for an invalid ID', async () => {
      await expect(service.findOne('invalid-uuid')).rejects.toHaveProperty(
        'message',
        'The workflowId provided is not valid',
      );
    });

    it('should throw for a non-existent workflow', async () => {
      await expect(service.findOne(faker.string.uuid())).rejects.toHaveProperty(
        'message',
        'The workflow with the provided id does not exist',
      );
    });
  });

  describe('create', () => {
    it('should create a new workflow with valid data', async () => {
      const dto = generateRandomWorkflow();
      dto.artifactIds = [testArtifacts[0].id, testArtifacts[1].id];

      const result = await service.create(dto, testSubmitter);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toEqual(dto.title);
      expect(result.visibility).toBe(RecordVisibility.PRIVATE);
    });

    it('should throw for invalid email', async () => {
      const dto = generateRandomWorkflow();
      await expect(
        service.create(dto, { username: 'x', email: 'bad' }),
      ).rejects.toHaveProperty('message', 'Invalid submitter email provided.');
    });

    it('should throw for short title', async () => {
      const dto = generateRandomWorkflow();
      dto.title = 'Ab';
      await expect(service.create(dto, testSubmitter)).rejects.toHaveProperty(
        'message',
        'The title of the workflow is required and must be at least 3 characters long',
      );
    });

    it('should throw for short description', async () => {
      const dto = generateRandomWorkflow();
      dto.description = 'Too short';
      await expect(service.create(dto, testSubmitter)).rejects.toHaveProperty(
        'message',
        'The description must be at least 50 characters long',
      );
    });

    it('should throw for duplicate title', async () => {
      const dto = generateRandomWorkflow();
      dto.title = workflowList[0].title;
      await expect(service.create(dto, testSubmitter)).rejects.toHaveProperty(
        'message',
        'A workflow with this title already exists in the organization',
      );
    });

    it('should throw for non-existent artifact IDs', async () => {
      const dto = generateRandomWorkflow();
      dto.artifactIds = [faker.string.uuid()];
      await expect(service.create(dto, testSubmitter)).rejects.toHaveProperty(
        'message',
        expect.stringContaining('do not exist'),
      );
    });

    it('should publish workflow.submit on create', async () => {
      const dto = generateRandomWorkflow();
      const publishSpy = jest.spyOn(rabbitMQService, 'publishWorkflowSubmit');
      await service.create(dto, testSubmitter);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            authenticatedUserId: testSubmitter.userId,
            organizationId: organization.id,
            operation: 'workflow.create',
          }),
        }),
      );
    });

    it('should still resolve if publishWorkflowSubmit fails', async () => {
      const dto = generateRandomWorkflow();
      jest
        .spyOn(rabbitMQService, 'publishWorkflowSubmit')
        .mockRejectedValueOnce(new Error('broker down'));
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});
      const result = await service.create(dto, testSubmitter);
      expect(result.id).toBeDefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish workflow.submit'),
      );
      loggerSpy.mockRestore();
    });
  });

  describe('updateUser', () => {
    it('should update keywords and publish workflow.update', async () => {
      const stored = workflowList[0];
      const dto: any = {
        submission_comment:
          'Updating workflow details for traceability and audit purposes.',
        keywords: ['newkw1', 'newkw2'],
      };
      const publishSpy = jest.spyOn(rabbitMQService, 'publishWorkflowUpdate');
      const result = await service.updateUser(
        stored.id,
        dto,
        undefined,
        undefined,
        undefined,
        testSubmitter.userId,
      );
      expect(result.keywords).toEqual(['newkw1', 'newkw2']);
      expect(publishSpy).toHaveBeenCalled();
    });

    it('should reject title in update DTO', async () => {
      const stored = workflowList[0];
      await expect(
        service.updateUser(stored.id, { title: 'x' } as any),
      ).rejects.toHaveProperty('message', 'Cannot update title or description');
    });

    it('should update artifact references', async () => {
      const stored = workflowList[0];
      const dto: any = {
        submission_comment:
          'Updating workflow artifact references for completeness check.',
        artifactIds: [testArtifacts[1].id, testArtifacts[2].id],
      };
      const result = await service.updateUser(
        stored.id,
        dto,
        undefined,
        undefined,
        undefined,
        testSubmitter.userId,
      );
      expect(result).toBeDefined();
    });
  });

  describe('updateWorker', () => {
    it('should update submission state to SUCCESS', async () => {
      const stored = workflowList[0];
      const dto: any = {
        submissionState: SubmissionState.SUCCESS,
        blockchainTxId: '0xabc',
        peerId: 'peer-1',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      const result = await service.updateWorker(stored.id, dto);
      expect(result.submissionState).toBe(SubmissionState.SUCCESS);
      expect(result.blockchainTxId).toBe('0xabc');
      expect(result.submissionError).toBeNull();
    });

    it('should set submissionError on FAILED', async () => {
      const stored = workflowList[0];
      const dto: any = {
        submissionState: SubmissionState.FAILED,
        submissionError: 'chaincode error',
      };
      const result = await service.updateWorker(stored.id, dto);
      expect(result.submissionError).toContain('Error submitting the workflow');
    });

    it('should reject unknown fields in status update', async () => {
      const stored = workflowList[0];
      await expect(
        service.updateWorker(stored.id, { title: 'nope' } as any),
      ).rejects.toHaveProperty('message');
    });
  });
});
