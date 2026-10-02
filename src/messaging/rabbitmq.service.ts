import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { connect, ChannelModel, ConfirmChannel, Options } from 'amqplib';
import { ManifestItem } from 'src/artifact/artifact.entity';
import { GitHubRepositoryItem } from 'src/workflow/workflow.entity';

export interface OrganizationContext {
  id: string;
  name: string;
  slug?: string;
  mspId?: string;
  ledgerGroupName?: string;
  ledgerApiUserId?: string;
  artifactSchemaName?: string;
}

export interface TransactionRequestMetadata {
  authenticatedUserId: string;
  organizationId: string;
  correlationId: string;
  operation:
    | 'artifact.create'
    | 'artifact.update'
    | 'workflow.create'
    | 'workflow.update';
  requestedAt: string;
}

export interface ArtifactUpdatedEvent {
  artifactId: string;
  keywords?: string[];
  footprint?: string;
  links?: string[];
  dois?: string[];
  fundingAgencies?: string[];
  acknowledgements?: string;
  manifest?: ManifestItem[];
  verified?: boolean;
  lastTimeVerified?: string | null;
  updatedAt: string;
  version: string;
}

// Command sent when an artifact is ready to be submitted downstream
export interface ArtifactSubmitCommand {
  contractVersion?: 'v1' | 'v2' | 'v3';
  artifactId: string;
  organization?: OrganizationContext;
  manifest: ManifestItem[];
  title: string;
  visibility?: string;
  footprint: string;
  description?: string;
  submission_comment?: string;
  keywords?: string[];
  links?: string[];
  dois?: string[];
  fundingAgencies?: string[];
  acknowledgements?: string;
  contributor?: string;
  correlationId?: string;
  request: TransactionRequestMetadata;
}

// Command to request updating artifact details downstream
export interface ArtifactUpdateCommandPatch {
  title?: string;
  description?: string;
  contributor?: string;
  submission_comment?: string;
  keywords?: string[];
  links?: string[];
  dois?: string[];
  fundingAgencies?: string[];
  acknowledgements?: string;
  manifest?: ManifestItem[];
  footprint?: string;
  // status fields removed from user patch
}

export interface ArtifactUpdateCommand {
  contractVersion?: 'v1' | 'v2' | 'v3';
  artifactId: string;
  organization?: OrganizationContext;
  patch: ArtifactUpdateCommandPatch;
  contributor?: string;
  correlationId?: string;
  request: TransactionRequestMetadata;
}

export interface WorkflowSubmitCommand {
  contractVersion?: 'v1' | 'v2' | 'v3';
  workflowId: string;
  organization?: OrganizationContext;
  title: string;
  visibility?: string;
  description?: string;
  submission_comment?: string;
  keywords?: string[];
  githubRepositories?: GitHubRepositoryItem[];
  artifactIds?: string[];
  contributor?: string;
  correlationId?: string;
  request: TransactionRequestMetadata;
}

export interface WorkflowUpdateCommandPatch {
  title?: string;
  description?: string;
  submission_comment?: string;
  keywords?: string[];
  githubRepositories?: GitHubRepositoryItem[];
  artifactIds?: string[];
  contributor?: string;
}

export interface WorkflowUpdateCommand {
  contractVersion?: 'v1' | 'v2' | 'v3';
  workflowId: string;
  organization?: OrganizationContext;
  patch: WorkflowUpdateCommandPatch;
  contributor?: string;
  correlationId?: string;
  request: TransactionRequestMetadata;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 5000; // 5 seconds

  private readonly exchangeName = 'artifact.exchange';
  private readonly artifactUpdatedRoutingKey = 'artifact.updated';
  private readonly artifactSubmitRoutingKey = 'artifact.submit';
  private readonly artifactUpdateRoutingKey = 'artifact.update';
  private readonly workflowSubmitRoutingKey = 'workflow.submit';
  private readonly workflowUpdateRoutingKey = 'workflow.update';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  private async publishJsonWithRetry(
    routingKey: string,
    payload: unknown,
    options: {
      messageId?: string;
      addTimestamp?: boolean;
      logSuccess: string;
      logPrefix: string;
    },
  ): Promise<void> {
    const maxRetries = 3;
    let retry = 0;
    while (retry < maxRetries) {
      try {
        await this.ensureConnection();
        if (!this.channel) throw new Error('RabbitMQ channel is not available');

        const buffer = Buffer.from(JSON.stringify(payload));
        const acceptedWithoutBackpressure = this.channel.publish(
          this.exchangeName,
          routingKey,
          buffer,
          {
            persistent: true,
            contentType: 'application/json',
            messageId: options.messageId,
            timestamp: options.addTimestamp ? Date.now() : undefined,
          },
        );

        if (!acceptedWithoutBackpressure) {
          await new Promise<void>((resolve) => {
            this.channel?.once('drain', resolve);
          });
        }

        await this.channel.waitForConfirms();
        this.logger.log(options.logSuccess);
        return;
      } catch (err) {
        retry++;
        this.logger.error(
          `${options.logPrefix} publish error (${retry}/3)`,
          err,
        );
        if (retry >= maxRetries) throw err;
        this.connection = null;
        this.channel = null;
        await this.sleep(2000);
      }
    }
  }
  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    if (this.isConnecting) {
      this.logger.log('Connection attempt already in progress');
      return;
    }

    this.isConnecting = true;

    try {
      const rabbitmqHost = this.configService.get<string>(
        'RABBITMQ_HOST',
        'localhost',
      );
      const rabbitmqPort = Number(
        this.configService.get<number>('RABBITMQ_PORT', 5672),
      );
      const rabbitmqUser = this.configService.get<string>(
        'RABBITMQ_USER',
        'guest',
      );
      const rabbitmqPass = this.configService.get<string>(
        'RABBITMQ_PASS',
        'guest',
      );

      const nodeEnv = this.configService.get<string>(
        'NODE_ENV',
        process.env.NODE_ENV || 'development',
      );
      const protocol = this.configService
        .get<string>(
          'RABBITMQ_PROTOCOL',
          nodeEnv === 'production' ? 'amqps' : 'amqp',
        )
        .toLowerCase();
      const allowInsecureLocal =
        this.configService.get<string>(
          'RABBITMQ_ALLOW_INSECURE_LOCAL',
          'false',
        ) === 'true';
      const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

      if (protocol !== 'amqp' && protocol !== 'amqps') {
        throw new Error('RABBITMQ_PROTOCOL must be amqp or amqps');
      }
      if (protocol === 'amqp' && nodeEnv === 'production') {
        throw new Error('RabbitMQ TLS is required in production');
      }
      if (
        protocol === 'amqp' &&
        !allowInsecureLocal &&
        !localHostnames.has(rabbitmqHost)
      ) {
        throw new Error(
          'Plain AMQP is restricted to localhost unless RABBITMQ_ALLOW_INSECURE_LOCAL=true',
        );
      }

      const connectionOptions: Options.Connect = {
        protocol,
        hostname: rabbitmqHost,
        port: rabbitmqPort,
        username: rabbitmqUser,
        password: rabbitmqPass,
        vhost: this.configService.get<string>('RABBITMQ_VHOST', '/'),
        heartbeat: Number(
          this.configService.get<number>('RABBITMQ_HEARTBEAT_SECONDS', 30),
        ),
      };

      const socketOptions: Record<string, unknown> = {};
      if (protocol === 'amqps') {
        socketOptions.rejectUnauthorized = true;
        socketOptions.servername = this.configService.get<string>(
          'RABBITMQ_TLS_SERVERNAME',
          rabbitmqHost,
        );
        const caPath = this.configService.get<string>('RABBITMQ_TLS_CA_PATH');
        if (caPath) socketOptions.ca = [readFileSync(caPath)];
      }

      this.logger.log(
        `Attempting to connect to RabbitMQ at ${rabbitmqHost}:${rabbitmqPort}`,
      );

      this.connection = await connect(connectionOptions, socketOptions);
      this.channel = await this.connection.createConfirmChannel();

      // Ensure the exchange exists (it should already exist from broker definitions)
      await this.channel.assertExchange(this.exchangeName, 'topic', {
        durable: true,
      });

      this.logger.log('Successfully connected to RabbitMQ');
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection

      // Handle connection errors and implement reconnection
      this.connection.on('error', (err: any) => {
        this.logger.error('RabbitMQ connection error:', err);
        this.handleConnectionLoss();
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.handleConnectionLoss();
      });

      // Handle channel errors
      this.channel.on('error', (err: any) => {
        this.logger.error('RabbitMQ channel error:', err);
        this.handleConnectionLoss();
      });

      this.channel.on('close', () => {
        this.logger.warn('RabbitMQ channel closed');
        this.handleConnectionLoss();
      });
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);
      this.handleConnectionLoss();
    } finally {
      this.isConnecting = false;
    }
  }

  private handleConnectionLoss(): void {
    this.connection = null;
    this.channel = null;
    this.isConnecting = false;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.logger.log(
        `Attempting to reconnect to RabbitMQ (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
      );

      const timer: any = setTimeout(() => {
        this.connect().catch((error) => {
          this.logger.error('Reconnection attempt failed:', error);
        });
      }, this.reconnectDelay);
      timer?.unref?.();
    } else {
      this.logger.error(
        'Max reconnection attempts reached. Manual intervention required.',
      );
    }
  }

  private async ensureConnection(): Promise<void> {
    if (!this.isConnected() && !this.isConnecting) {
      this.logger.log('Connection lost, attempting to reconnect...');
      await this.connect();
    }

    // Wait for connection to be established
    let attempts = 0;
    const maxWaitAttempts = 10;
    while (!this.isConnected() && attempts < maxWaitAttempts) {
      await this.sleep(1000);
      attempts++;
    }

    if (!this.isConnected()) {
      throw new Error('Unable to establish RabbitMQ connection');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t: any = setTimeout(resolve, ms);
      t?.unref?.();
    });
  }

  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.logger.log('Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  async publishArtifactUpdated(event: ArtifactUpdatedEvent): Promise<void> {
    await this.publishJsonWithRetry(this.artifactUpdatedRoutingKey, event, {
      messageId: event.artifactId,
      addTimestamp: true,
      logSuccess: `Published artifact.updated event for artifact: ${event.artifactId}`,
      logPrefix: 'artifact.updated',
    });
  }

  async publishArtifactSubmit(cmd: ArtifactSubmitCommand): Promise<void> {
    await this.publishJsonWithRetry(this.artifactSubmitRoutingKey, cmd, {
      messageId: cmd.artifactId,
      logSuccess: `Published artifact.submit command for artifact ${cmd.artifactId}`,
      logPrefix: 'artifact.submit',
    });
  }

  async publishArtifactUpdate(cmd: ArtifactUpdateCommand): Promise<void> {
    await this.publishJsonWithRetry(this.artifactUpdateRoutingKey, cmd, {
      messageId: cmd.artifactId,
      logSuccess: `Published artifact.update command for artifact ${cmd.artifactId}`,
      logPrefix: 'artifact.update',
    });
  }

  async publishWorkflowSubmit(cmd: WorkflowSubmitCommand): Promise<void> {
    await this.publishJsonWithRetry(this.workflowSubmitRoutingKey, cmd, {
      messageId: cmd.workflowId,
      logSuccess: `Published workflow.submit command for workflow ${cmd.workflowId}`,
      logPrefix: 'workflow.submit',
    });
  }

  async publishWorkflowUpdate(cmd: WorkflowUpdateCommand): Promise<void> {
    await this.publishJsonWithRetry(this.workflowUpdateRoutingKey, cmd, {
      messageId: cmd.workflowId,
      logSuccess: `Published workflow.update command for workflow ${cmd.workflowId}`,
      logPrefix: 'workflow.update',
    });
  }

  async publishOutboxMessage(
    routingKey: string,
    payload: Record<string, unknown>,
    messageId: string,
  ): Promise<void> {
    await this.publishJsonWithRetry(routingKey, payload, {
      messageId,
      addTimestamp: true,
      logSuccess: `Published outbox message ${messageId} to ${routingKey}`,
      logPrefix: routingKey,
    });
  }

  // Health check method
  isConnected(): boolean {
    return (
      this.connection !== null && this.channel !== null && !this.isConnecting
    );
  }

  // Get connection status for debugging
  getConnectionStatus(): {
    connected: boolean;
    reconnectAttempts: number;
    isConnecting: boolean;
  } {
    return {
      connected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      isConnecting: this.isConnecting,
    };
  }
}
