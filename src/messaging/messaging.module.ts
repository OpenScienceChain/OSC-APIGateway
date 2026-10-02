import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([OutboxEntity])],
  providers: [RabbitMQService, OutboxService],
  exports: [RabbitMQService, OutboxService],
})
export class MessagingModule {}
