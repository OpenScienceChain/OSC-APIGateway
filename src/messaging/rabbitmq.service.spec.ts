import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';
import {
  ArtifactUpdatedEvent,
  ArtifactUpdateCommand,
} from './rabbitmq.service';
import * as amqplib from 'amqplib';
import { LoggerService } from '@nestjs/common';

// Mock amqplib
jest.mock('amqplib');
const mockedAmqplib = amqplib as jest.Mocked<typeof amqplib>;

class SilentLogger implements LoggerService {
  log() {}
  error() {}
  warn() {}
  debug?() {}
  verbose?() {}
}

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let config: Record<string, unknown>;

  const mockChannel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockReturnValue(true),
    waitForConfirms: jest.fn().mockResolvedValue(undefined),
    once: jest.fn((_event: string, callback: () => void) => callback()),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const mockConnection = {
    createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockChannel.publish.mockReset().mockReturnValue(true);
    mockChannel.waitForConfirms.mockReset().mockResolvedValue(undefined);
    mockChannel.once.mockImplementation(
      (_event: string, callback: () => void) => callback(),
    );
    (mockedAmqplib.connect as jest.Mock).mockResolvedValue(
      mockConnection as any,
    );
    config = {
      RABBITMQ_HOST: 'localhost',
      RABBITMQ_PORT: 5672,
      RABBITMQ_USER: 'guest',
      RABBITMQ_PASS: 'guest',
      RABBITMQ_PROTOCOL: 'amqp',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMQService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    })
      .setLogger(new SilentLogger()) // Disable logging for tests
      .compile();

    service = module.get<RabbitMQService>(RabbitMQService);
    // Fake timers are now enabled only in the specific tests that need them.
  });

  // No longer using fake timers globally
  // afterEach(() => {
  //   jest.useRealTimers();
  // });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should call connect on module init', async () => {
      const connectSpy = jest.spyOn(service as any, 'connect');
      await service.onModuleInit();
      expect(connectSpy).toHaveBeenCalled();
      connectSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should call disconnect on module destroy', async () => {
      await (service as any).connect(); // connect first
      const disconnectSpy = jest.spyOn(service as any, 'disconnect');
      await service.onModuleDestroy();
      expect(disconnectSpy).toHaveBeenCalled();
      disconnectSpy.mockRestore();
    });
  });

  describe('connect', () => {
    it('should connect to RabbitMQ successfully', async () => {
      await (service as any).connect();
      expect(mockedAmqplib.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          protocol: 'amqp',
          hostname: 'localhost',
          port: 5672,
          username: 'guest',
          password: 'guest',
        }),
        {},
      );
      expect(mockConnection.createConfirmChannel).toHaveBeenCalled();
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'artifact.exchange',
        'topic',
        { durable: true },
      );
      expect(service.isConnected()).toBe(true);
    });

    it('should not attempt to connect if already connecting', async () => {
      (service as any).isConnecting = true;
      await (service as any).connect();
      expect(mockedAmqplib.connect).not.toHaveBeenCalled();
    });

    it('should handle connection failure and trigger reconnection', async () => {
      const error = new Error('Connection failed');
      (mockedAmqplib.connect as jest.Mock).mockRejectedValueOnce(error);
      const handleConnectionLossSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => {});

      await (service as any).connect();

      expect(handleConnectionLossSpy).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
      handleConnectionLossSpy.mockRestore();
    });

    it('should configure certificate validation for AMQPS', async () => {
      config.RABBITMQ_PROTOCOL = 'amqps';
      config.RABBITMQ_PORT = 5671;
      config.RABBITMQ_TLS_SERVERNAME = 'broker.example.test';

      await (service as any).connect();

      expect(mockedAmqplib.connect).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'amqps', port: 5671 }),
        expect.objectContaining({
          rejectUnauthorized: true,
          servername: 'broker.example.test',
        }),
      );
    });

    it('should reject plain AMQP in production', async () => {
      config.NODE_ENV = 'production';
      config.RABBITMQ_PROTOCOL = 'amqp';
      const handleConnectionLossSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => undefined);

      await (service as any).connect();

      expect(mockedAmqplib.connect).not.toHaveBeenCalled();
      expect(handleConnectionLossSpy).toHaveBeenCalled();
    });
  });

  describe('handleConnectionLoss', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should attempt to reconnect if max attempts not reached', () => {
      const connectSpy = jest
        .spyOn(service as any, 'connect')
        .mockResolvedValue(undefined);
      (service as any).reconnectAttempts = 0;

      (service as any).handleConnectionLoss();

      expect((service as any).connection).toBeNull();
      expect((service as any).channel).toBeNull();
      expect((service as any).isConnecting).toBe(false);
      expect((service as any).reconnectAttempts).toBe(1);

      jest.advanceTimersByTime(5000);

      expect(connectSpy).toHaveBeenCalled();
      connectSpy.mockRestore();
    });

    it('should not attempt to reconnect if max attempts reached', () => {
      const connectSpy = jest.spyOn(service as any, 'connect');
      (service as any).reconnectAttempts = 10;

      (service as any).handleConnectionLoss();

      expect((service as any).reconnectAttempts).toBe(10); // Should not increment

      jest.advanceTimersByTime(5000);

      expect(connectSpy).not.toHaveBeenCalled();
      connectSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should close the channel and connection', async () => {
      await (service as any).connect(); // First connect to have something to close
      await (service as any).disconnect();
      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });

    it('should handle errors during disconnection gracefully', async () => {
      await (service as any).connect();
      mockChannel.close.mockRejectedValueOnce(new Error('Channel close error'));

      // We expect no exception to be thrown
      await expect((service as any).disconnect()).resolves.not.toThrow();
      // The connection should NOT be closed if the channel fails to close,
      // as the error is caught and logged.
      expect(mockConnection.close).not.toHaveBeenCalled();
    });
  });

  describe('publishArtifactUpdated', () => {
    const updatedEvent: ArtifactUpdatedEvent = {
      artifactId: '123',
      keywords: ['upd'],
      footprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      links: [],
      dois: [],
      fundingAgencies: [],
      acknowledgements: '',
      manifest: undefined,
      verified: true,
      lastTimeVerified: null,
      updatedAt: new Date().toISOString(),
      version: '1',
    };

    it('should publish an updated event successfully', async () => {
      await (service as any).connect();
      await service.publishArtifactUpdated(updatedEvent);
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'artifact.exchange',
        'artifact.updated',
        expect.any(Buffer),
        expect.objectContaining({ messageId: updatedEvent.artifactId }),
      );
      expect(mockChannel.waitForConfirms).toHaveBeenCalled();
    });

    it('should wait for channel drain when the write buffer applies backpressure', async () => {
      mockChannel.publish.mockReturnValue(false);
      await (service as any).connect();

      await service.publishArtifactUpdated(updatedEvent);

      expect(mockChannel.once).toHaveBeenCalledWith(
        'drain',
        expect.any(Function),
      );
      expect(mockChannel.waitForConfirms).toHaveBeenCalled();
    });

    it('should throw error after retries on updated event', async () => {
      await (service as any).connect();
      mockChannel.publish.mockImplementation(() => {
        throw new Error('fail');
      });
      await expect(
        service.publishArtifactUpdated(updatedEvent),
      ).rejects.toThrow('fail');
    }, 10000);
  });

  describe('publishArtifactUpdate', () => {
    const cmd: ArtifactUpdateCommand = {
      artifactId: 'abc-123',
      patch: {
        keywords: ['a'],
        footprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      request: {
        authenticatedUserId: 'user-1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        operation: 'artifact.update',
        requestedAt: '2026-09-01T00:00:00.000Z',
      },
    };

    it('should publish an update command successfully', async () => {
      // Ensure previous tests throwing publish do not leak into this test
      (mockChannel.publish as jest.Mock).mockReset();
      (mockChannel.publish as jest.Mock).mockReturnValue(true);
      await (service as any).connect();
      await service.publishArtifactUpdate(cmd);
      expect(mockChannel.publish).toHaveBeenCalledWith(
        'artifact.exchange',
        'artifact.update',
        expect.any(Buffer),
        expect.objectContaining({ messageId: cmd.artifactId }),
      );
    });

    it('should throw error after retries on update command', async () => {
      await (service as any).connect();
      (mockChannel.publish as jest.Mock).mockImplementation(() => {
        throw new Error('fail');
      });
      await expect(service.publishArtifactUpdate(cmd)).rejects.toThrow('fail');
      // Reset publish for other tests
      (mockChannel.publish as jest.Mock).mockReset();
      (mockChannel.publish as jest.Mock).mockReturnValue(true);
    }, 10000);
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      await (service as any).connect();
      expect(service.isConnected()).toBe(true);
    });

    it('should return false when not connected', () => {
      expect(service.isConnected()).toBe(false);
    });

    it('should return false when connecting', async () => {
      (service as any).isConnecting = true;
      // The real connect() method returns early if isConnecting is true.
      await (service as any).connect();
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('getConnectionStatus', () => {
    it('should return the current connection status', () => {
      const status = service.getConnectionStatus();
      expect(status).toEqual({
        connected: false,
        reconnectAttempts: 0,
        isConnecting: false,
      });
    });
  });

  describe('ensureConnection', () => {
    it('should call connect if not connected', async () => {
      const connectSpy = jest
        .spyOn(service as any, 'connect')
        .mockResolvedValue(undefined);
      (service as any).connection = null;

      // This will call connect, but since connect is mocked to resolve immediately
      // and isConnected will still be false, it will wait.
      // We need to make isConnected return true after connect is called.
      connectSpy.mockImplementation(async () => {
        (service as any).connection = mockConnection;
        (service as any).channel = mockChannel;
      });

      await (service as any).ensureConnection();

      expect(connectSpy).toHaveBeenCalled();
      connectSpy.mockRestore();
    });
  });

  describe('Connection and Channel event handlers', () => {
    it('should handle connection "error" event', async () => {
      const handleSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => {});
      await (service as any).connect();
      const errorCallback = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'error',
      )[1];
      errorCallback(new Error('Connection error'));
      expect(handleSpy).toHaveBeenCalled();
      handleSpy.mockRestore();
    });

    it('should handle connection "close" event', async () => {
      const handleSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => {});
      await (service as any).connect();
      const closeCallback = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'close',
      )[1];
      closeCallback();
      expect(handleSpy).toHaveBeenCalled();
      handleSpy.mockRestore();
    });

    it('should handle channel "error" event', async () => {
      const handleSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => {});
      await (service as any).connect();
      const errorCallback = mockChannel.on.mock.calls.find(
        (call) => call[0] === 'error',
      )[1];
      errorCallback(new Error('Channel error'));
      expect(handleSpy).toHaveBeenCalled();
      handleSpy.mockRestore();
    });

    it('should handle channel "close" event', async () => {
      const handleSpy = jest
        .spyOn(service as any, 'handleConnectionLoss')
        .mockImplementation(() => {});
      await (service as any).connect();
      const closeCallback = mockChannel.on.mock.calls.find(
        (call) => call[0] === 'close',
      )[1];
      closeCallback();
      expect(handleSpy).toHaveBeenCalled();
      handleSpy.mockRestore();
    });
  });
});
