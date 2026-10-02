import { Logger } from '@nestjs/common';
import { OutboxEntity, OutboxStatus } from './outbox.entity';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  const repository = {
    find: jest.fn(),
    save: jest.fn(),
  };
  const rabbitMQService = {
    publishOutboxMessage: jest.fn(),
  };
  const configService = {
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  };
  let service: OutboxService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OutboxService(
      repository as any,
      rabbitMQService as any,
      configService as any,
    );
  });

  it('enqueues a pending message through the caller transaction', async () => {
    const message = { id: 'outbox-1' } as OutboxEntity;
    const manager = {
      create: jest.fn().mockReturnValue(message),
      save: jest.fn().mockResolvedValue(message),
    };

    await expect(
      service.enqueue(
        manager as any,
        'artifact.submit',
        'artifact-1',
        { artifactId: 'artifact-1' },
        'message-1',
      ),
    ).resolves.toBe(message);

    expect(manager.create).toHaveBeenCalledWith(
      OutboxEntity,
      expect.objectContaining({
        routingKey: 'artifact.submit',
        aggregateId: 'artifact-1',
        messageId: 'message-1',
        status: OutboxStatus.PENDING,
        attempts: 0,
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(OutboxEntity, message);
  });

  it('marks a delivered message as published', async () => {
    const message = makeMessage();
    repository.find.mockResolvedValue([message]);
    repository.save.mockResolvedValue(message);
    rabbitMQService.publishOutboxMessage.mockResolvedValue(undefined);

    await service.dispatchPending();

    expect(rabbitMQService.publishOutboxMessage).toHaveBeenCalledWith(
      message.routingKey,
      message.payload,
      message.messageId,
    );
    expect(message.status).toBe(OutboxStatus.PUBLISHED);
    expect(message.publishedAt).toBeInstanceOf(Date);
    expect(message.lastError).toBeNull();
    expect(repository.save).toHaveBeenCalledWith(message);
  });

  it('backs off a failed message without losing it', async () => {
    const message = makeMessage();
    const beforeAttempt = Date.now();
    repository.find.mockResolvedValue([message]);
    repository.save.mockResolvedValue(message);
    rabbitMQService.publishOutboxMessage.mockRejectedValue(
      new Error('broker unavailable'),
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.dispatchPending();

    expect(message.status).toBe(OutboxStatus.PENDING);
    expect(message.attempts).toBe(1);
    expect(message.lastError).toBe('broker unavailable');
    expect(message.availableAt.getTime()).toBeGreaterThanOrEqual(
      beforeAttempt + 2000,
    );
    expect(repository.save).toHaveBeenCalledWith(message);
  });

  it('marks a message failed after the configured retry limit', async () => {
    const message = makeMessage();
    message.attempts = 2;
    configService.get.mockReturnValueOnce(3);
    repository.find.mockResolvedValue([message]);
    repository.save.mockResolvedValue(message);
    rabbitMQService.publishOutboxMessage.mockRejectedValue(
      new Error('broker unavailable'),
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.dispatchPending();

    expect(message.attempts).toBe(3);
    expect(message.status).toBe(OutboxStatus.FAILED);
    expect(repository.save).toHaveBeenCalledWith(message);
  });
});

function makeMessage(): OutboxEntity {
  return {
    id: 'outbox-1',
    routingKey: 'artifact.submit',
    aggregateId: 'artifact-1',
    messageId: 'message-1',
    payload: { artifactId: 'artifact-1' },
    status: OutboxStatus.PENDING,
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
    publishedAt: null,
    lastError: null,
  };
}
