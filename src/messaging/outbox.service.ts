import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { RabbitMQService } from './rabbitmq.service';
import { OutboxEntity, OutboxStatus } from './outbox.entity';

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    @InjectRepository(OutboxEntity)
    private readonly repository: Repository<OutboxEntity>,
    private readonly rabbitMQService: RabbitMQService,
    private readonly configService: ConfigService,
  ) {}

  private get maxAttempts(): number {
    const configured = Number(
      this.configService.get<number>('OUTBOX_MAX_ATTEMPTS', 8),
    );
    return Number.isInteger(configured) && configured > 0 ? configured : 8;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchPending(), 5000);
    this.timer.unref?.();
    void this.dispatchPending();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(
    manager: EntityManager,
    routingKey: string,
    aggregateId: string,
    payload: Record<string, unknown>,
    messageId: string,
  ): Promise<OutboxEntity> {
    return manager.save(
      OutboxEntity,
      manager.create(OutboxEntity, {
        routingKey,
        aggregateId,
        payload,
        messageId,
        status: OutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
      }),
    );
  }

  async dispatchPending(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;

    try {
      const messages = await this.repository.find({
        where: {
          status: OutboxStatus.PENDING,
          availableAt: LessThanOrEqual(new Date()),
        },
        order: { createdAt: 'ASC' },
        take: 25,
      });

      for (const message of messages) {
        try {
          await this.rabbitMQService.publishOutboxMessage(
            message.routingKey,
            message.payload,
            message.messageId,
          );
          message.status = OutboxStatus.PUBLISHED;
          message.publishedAt = new Date();
          message.lastError = null;
        } catch (error) {
          message.attempts += 1;
          message.lastError =
            error instanceof Error ? error.message : String(error);
          if (message.attempts >= this.maxAttempts) {
            message.status = OutboxStatus.FAILED;
            this.logger.error(
              `Outbox delivery ${message.id} exhausted ${message.attempts} attempts`,
            );
          } else {
            message.availableAt = new Date(
              Date.now() + Math.min(60000, 1000 * 2 ** message.attempts),
            );
            this.logger.warn(
              `Outbox delivery ${message.id} failed; attempt ${message.attempts}`,
            );
          }
        }
        await this.repository.save(message);
      }
    } finally {
      this.dispatching = false;
    }
  }
}
