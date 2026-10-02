import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEntity } from './workflow.entity';
import { SubmissionState } from '../artifact/enums/submission-state.enum';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function makeListDto(overrides: Partial<any> = {}) {
  return {
    id: 'some-uuid',
    title: 'Test Workflow',
    description: 'Test description that is long enough for validation',
    keywords: ['kw1'],
    submissionState: SubmissionState.PENDING,
    submittedAt: new Date(),
    updatedAt: null,
    ...overrides,
  };
}

function makeGetDto(overrides: Partial<any> = {}) {
  return {
    id: 'some-uuid',
    title: 'Test Workflow',
    description: 'Test description',
    submission_comment: 'A long enough submission comment for testing',
    keywords: [],
    githubRepositories: [],
    artifacts: [],
    submissionState: SubmissionState.PENDING,
    submitterEmail: 'user@example.com',
    submitterUsername: 'user',
    submittedAt: new Date(),
    updatedAt: null,
    blockchainTxId: null,
    peerId: null,
    submissionError: null,
    organization: { name: 'OSC' },
    ...overrides,
  };
}

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let workflowService: jest.Mocked<WorkflowService>;

  beforeEach(async () => {
    const mockWorkflowService: Partial<jest.Mocked<WorkflowService>> = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      updateUser: jest.fn(),
      updateWorker: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<WorkflowController>(WorkflowController);
    workflowService = module.get(WorkflowService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    const createDto: any = {
      title: 'New Workflow Title',
      description:
        'A description that is long enough to pass validation checks in the service layer.',
      submission_comment: 'A submission comment that is long enough.',
      keywords: ['k1'],
      githubRepositories: [],
      artifactIds: [],
    };

    it('should call service.create with submitterInfo from req.user', async () => {
      const req: any = {
        user: {
          id: 'user-1',
          username: 'alice',
          email: 'alice@example.com',
          organizationId: 'org-1',
        },
      };
      const expected = makeListDto({ title: createDto.title });
      workflowService.create.mockResolvedValue(expected as any);

      const result = await controller.create(req, createDto, undefined);
      expect(workflowService.create).toHaveBeenCalledWith(
        createDto,
        {
          userId: 'user-1',
          username: 'alice',
          email: 'alice@example.com',
          organizationId: 'org-1',
        },
        undefined,
      );
      expect(result).toBe(expected);
    });

    it('should throw UnauthorizedException when req.user is missing', async () => {
      const req: any = { user: null };
      await expect(
        controller.create(req, createDto, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('findAll', () => {
    it('should return an array of list DTOs', async () => {
      const list = [makeListDto(), makeListDto({ id: 'other-uuid' })];
      workflowService.findAll.mockResolvedValue(list as any);
      const result = await controller.findAll();
      expect(result).toBe(list);
    });
  });

  describe('findOne', () => {
    it('should return a single workflow DTO by ID', async () => {
      const dto = makeGetDto();
      workflowService.findOne.mockResolvedValue(dto as any);
      const result = await controller.findOne('some-uuid');
      expect(result).toBe(dto);
    });
  });

  describe('updateUser', () => {
    it('should call service.updateUser with user email', async () => {
      const req: any = {
        user: {
          id: 'user-1',
          email: 'alice@example.com',
          organizationId: 'org-1',
        },
      };
      const updateDto: any = {
        submission_comment:
          'Updated comment that is long enough to pass validation.',
        keywords: ['updated'],
      };
      const updated: any = {
        id: 'some-uuid',
        submission_comment: updateDto.submission_comment,
      };
      workflowService.updateUser.mockResolvedValue(updated as WorkflowEntity);

      const result = await controller.updateUser(
        req,
        'some-uuid',
        updateDto,
        'corr-abc',
      );
      expect(result).toBe(updated);
      expect(workflowService.updateUser).toHaveBeenCalledWith(
        'some-uuid',
        updateDto,
        'alice@example.com',
        'corr-abc',
        'org-1',
        'user-1',
      );
    });
  });

  describe('updateWorker', () => {
    it('should call service.updateWorker and return the updated entity', async () => {
      const workerDto: any = {
        submissionState: SubmissionState.SUCCESS,
        blockchainTxId: '0xabc',
        peerId: 'peer-1',
      };
      const updated: any = { id: 'some-uuid', ...workerDto };
      workflowService.updateWorker.mockResolvedValue(updated as WorkflowEntity);

      const result = await controller.updateWorker('some-uuid', workerDto);
      expect(result).toBe(updated);
    });
  });
});
