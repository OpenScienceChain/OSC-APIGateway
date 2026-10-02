import { Test, TestingModule } from '@nestjs/testing';
import { ArtifactController } from './artifact.controller';
import { ArtifactService } from './artifact.service';
import { GhwService } from './ghw.service';
import { ArtifactEntity } from './artifact.entity';
import { SubmissionState } from './enums/submission-state.enum';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Minimal factory for a ListArtifactDto-like object
function makeListDto(overrides: Partial<any> = {}) {
  return {
    id: 'some-uuid',
    title: 'Test Artifact',
    description: 'Test description that is long enough',
    keywords: ['kw1'],
    footprint: 'a'.repeat(64),
    submittedAt: new Date(),
    verified: false,
    updatedAt: null,
    ...overrides,
  };
}

// Minimal GetArtifactDto-like object
function makeGetDto(overrides: Partial<any> = {}) {
  return {
    id: 'some-uuid',
    title: 'Test Artifact',
    description: 'Test description',
    submission_comment: 'A long enough submission comment for testing',
    keywords: [],
    footprint: 'a'.repeat(64),
    links: [],
    dois: [],
    fundingAgencies: [],
    acknowledgements: '',
    manifest: [],
    verified: false,
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

describe('ArtifactController', () => {
  let controller: ArtifactController;
  let artifactService: jest.Mocked<ArtifactService>;

  beforeEach(async () => {
    const mockArtifactService: Partial<jest.Mocked<ArtifactService>> = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      updateWorker: jest.fn(),
      updateUser: jest.fn(),
      getHistory: jest.fn(),
      refreshHistory: jest.fn(),
    };

    const mockGhwService: Partial<jest.Mocked<GhwService>> = {
      fetchHistory: jest.fn(),
      refresh: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArtifactController],
      providers: [
        { provide: ArtifactService, useValue: mockArtifactService },
        { provide: GhwService, useValue: mockGhwService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ArtifactController>(ArtifactController);
    artifactService = module.get(ArtifactService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---- create ----
  describe('create', () => {
    const createDto: any = {
      title: 'New Artifact Title',
      description:
        'A description that is long enough to pass validation checks in the service layer.',
      submission_comment: 'A submission comment that is long enough.',
      keywords: ['k1'],
      links: ['https://example.com'],
      dois: [],
      fundingAgencies: [],
      acknowledgements: '',
      manifest: [],
      footprint: 'a'.repeat(64),
    };

    it('should call service.create with submitterInfo extracted from req.user', async () => {
      const req: any = {
        user: {
          id: 'user-1',
          username: 'alice',
          email: 'alice@example.com',
          organizationId: 'org-1',
        },
      };
      const expected = makeListDto({ title: createDto.title });
      artifactService.create.mockResolvedValue(expected as any);

      const result = await controller.create(req, createDto, undefined);

      expect(artifactService.create).toHaveBeenCalledWith(
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

    it('should pass correlationId header to service.create', async () => {
      const req: any = {
        user: {
          id: 'user-2',
          username: 'bob',
          email: 'bob@example.com',
          organizationId: 'org-2',
        },
      };
      artifactService.create.mockResolvedValue(makeListDto() as any);

      await controller.create(req, createDto, 'corr-123');

      expect(artifactService.create).toHaveBeenCalledWith(
        createDto,
        expect.any(Object),
        'corr-123',
      );
    });

    it('should throw UnauthorizedException when req.user is missing', async () => {
      const req: any = { user: null };
      await expect(
        controller.create(req, createDto, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when req.user.email is missing', async () => {
      const req: any = { user: { username: 'alice' } };
      await expect(
        controller.create(req, createDto, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when req.user.username is missing', async () => {
      const req: any = {
        user: {
          id: 'user-1',
          email: 'alice@example.com',
          organizationId: 'org-1',
        },
      };
      await expect(
        controller.create(req, createDto, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---- findAll ----
  describe('findAll', () => {
    it('should return an array of list DTOs', async () => {
      const list = [makeListDto(), makeListDto({ id: 'other-uuid' })];
      artifactService.findAll.mockResolvedValue(list as any);

      const result = await controller.findAll();
      expect(result).toBe(list);
      expect(artifactService.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return an empty array when no artifacts exist', async () => {
      artifactService.findAll.mockResolvedValue([]);
      const result = await controller.findAll();
      expect(result).toEqual([]);
    });
  });

  // ---- findOne ----
  describe('findOne', () => {
    it('should return a single artifact DTO by ID', async () => {
      const dto = makeGetDto();
      artifactService.findOne.mockResolvedValue(dto as any);

      const result = await controller.findOne('some-uuid');
      expect(result).toBe(dto);
      expect(artifactService.findOne).toHaveBeenCalledWith(
        'some-uuid',
        undefined,
      );
    });

    it('should propagate exceptions from service.findOne', async () => {
      artifactService.findOne.mockRejectedValue(new Error('not found'));
      await expect(controller.findOne('bad-uuid')).rejects.toThrow('not found');
    });
  });

  // ---- delete ----
  describe('delete', () => {
    it('should call service.delete with the given ID', async () => {
      artifactService.delete.mockResolvedValue(undefined);
      await controller.delete('some-uuid');
      expect(artifactService.delete).toHaveBeenCalledWith(
        'some-uuid',
        undefined,
      );
    });

    it('should propagate exceptions from service.delete', async () => {
      artifactService.delete.mockRejectedValue(new Error('not found'));
      await expect(controller.delete('bad-uuid')).rejects.toThrow('not found');
    });
  });

  // ---- updateWorker (PATCH) ----
  describe('updateWorker', () => {
    it('should call service.updateWorker and return the updated entity', async () => {
      const workerDto: any = {
        submissionState: SubmissionState.SUCCESS,
        blockchainTxId: '0xabc',
        peerId: 'peer-1',
      };
      const updated: any = { id: 'some-uuid', ...workerDto };
      artifactService.updateWorker.mockResolvedValue(updated as ArtifactEntity);

      const result = await controller.updateWorker('some-uuid', workerDto);
      expect(result).toBe(updated);
      expect(artifactService.updateWorker).toHaveBeenCalledWith(
        'some-uuid',
        workerDto,
      );
    });

    it('should propagate exceptions from service.updateWorker', async () => {
      artifactService.updateWorker.mockRejectedValue(new Error('bad request'));
      await expect(controller.updateWorker('bad', {} as any)).rejects.toThrow(
        'bad request',
      );
    });
  });

  // ---- updateUser (PUT) ----
  describe('updateUser', () => {
    it('should call service.updateUser with user email from req and return entity', async () => {
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
      artifactService.updateUser.mockResolvedValue(updated as ArtifactEntity);

      const result = await controller.updateUser(
        req,
        'some-uuid',
        updateDto,
        'corr-abc',
      );
      expect(result).toBe(updated);
      expect(artifactService.updateUser).toHaveBeenCalledWith(
        'some-uuid',
        updateDto,
        'alice@example.com',
        'corr-abc',
        'org-1',
        'user-1',
      );
    });

    it('should pass undefined email when req.user is absent', async () => {
      const req: any = {};
      const updateDto: any = {
        submission_comment: 'Some comment that is long enough for test.',
      };
      artifactService.updateUser.mockResolvedValue({
        id: 'some-uuid',
      } as ArtifactEntity);

      await controller.updateUser(req, 'some-uuid', updateDto, undefined);
      expect(artifactService.updateUser).toHaveBeenCalledWith(
        'some-uuid',
        updateDto,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  // ---- getHistory ----
  describe('getHistory', () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';

    it('should call service.getHistory and return result', async () => {
      const historyResult = { items: [], total: 0, hasMore: false };
      artifactService.getHistory.mockResolvedValue(historyResult as any);

      const result = await controller.getHistory(
        artifactId,
        '0',
        '10',
        'desc',
        'true',
        'corr-1',
      );
      expect(result).toBe(historyResult);
      expect(artifactService.getHistory).toHaveBeenCalledWith(
        artifactId,
        { offset: '0', limit: '10', order: 'desc', includeValue: 'true' },
        'corr-1',
        undefined,
      );
    });

    it('should work without optional query params', async () => {
      artifactService.getHistory.mockResolvedValue({ items: [] } as any);
      await controller.getHistory(
        artifactId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(artifactService.getHistory).toHaveBeenCalledWith(
        artifactId,
        {
          offset: undefined,
          limit: undefined,
          order: undefined,
          includeValue: undefined,
        },
        undefined,
        undefined,
      );
    });

    it('should propagate exceptions from service.getHistory', async () => {
      artifactService.getHistory.mockRejectedValue(
        new Error('upstream timeout'),
      );
      await expect(
        controller.getHistory(
          artifactId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ).rejects.toThrow('upstream timeout');
    });
  });

  // ---- refreshHistory ----
  describe('refreshHistory', () => {
    const artifactId = '00000000-0000-4000-8000-000000000001';

    it('should call service.refreshHistory and return result', async () => {
      const refreshResult = { artifactId, total: 5 };
      artifactService.refreshHistory.mockResolvedValue(refreshResult as any);

      const result = await controller.refreshHistory(artifactId, 'corr-2');
      expect(result).toBe(refreshResult);
      expect(artifactService.refreshHistory).toHaveBeenCalledWith(
        artifactId,
        'corr-2',
        undefined,
      );
    });

    it('should propagate exceptions from service.refreshHistory', async () => {
      artifactService.refreshHistory.mockRejectedValue(new Error('ghw error'));
      await expect(
        controller.refreshHistory(artifactId, undefined),
      ).rejects.toThrow('ghw error');
    });
  });
});
