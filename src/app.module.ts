import { Module } from '@nestjs/common';
import * as fs from 'fs';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { OrganizationModule } from './organization/organization.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user/user.entity';
import { OrganizationEntity } from './organization/organization.entity';
import { ArtifactEntity } from './artifact/artifact.entity';
import { ArtifactModule } from './artifact/artifact.module';
import { WorkflowEntity } from './workflow/workflow.entity';
import { WorkflowModule } from './workflow/workflow.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { AddOrganizationLedgerRouting1720000000000 } from './migrations/1720000000000-add-organization-ledger-routing';
import { OutboxEntity } from './messaging/outbox.entity';
import { CreateMessageOutbox1720000001000 } from './migrations/1720000001000-create-message-outbox';
import { OrganizationMembershipEntity } from './organization/organization-membership.entity';
import { CreateOrganizationMemberships1720000002000 } from './migrations/1720000002000-create-organization-memberships';
import { AddRecordVisibility1720000003000 } from './migrations/1720000003000-add-record-visibility';
import { AddArtifactArchival1720000004000 } from './migrations/1720000004000-add-artifact-archival';
import { CreateBaselineSchema1719999999000 } from './migrations/1719999999000-create-baseline-schema';
import { DemoModule } from './demo/demo.module';
import { DemoSessionEntity } from './demo/entities/demo-session.entity';
import { DemoAccountEntity } from './demo/entities/demo-account.entity';
import { DemoRuntimeEntity } from './demo/entities/demo-runtime.entity';
import { DemoEventEntity } from './demo/entities/demo-event.entity';
import { DemoFeedbackEntity } from './demo/entities/demo-feedback.entity';
import { DemoContributionEntity } from './demo/entities/demo-contribution.entity';
import { DemoArtifactEditEntity } from './demo/entities/demo-artifact-edit.entity';
import { CreateUsrse26Demo1720000005000 } from './migrations/1720000005000-create-usrse26-demo';
import { RestoreDemoArtifactPortal1720000006000 } from './migrations/1720000006000-restore-demo-artifact-portal';
import { AddDemoAccounts1720000007000 } from './migrations/1720000007000-add-demo-accounts';
import { AddMagneticArchShowcase1720000008000 } from './migrations/1720000008000-add-magnetic-arch-showcase';
import { ShowcaseModule } from './showcase/showcase.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    UserModule,
    OrganizationModule,
    ArtifactModule,
    WorkflowModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const useSsl = configService.get<string>('DB_SSL', 'false') === 'true';
        let sslOption: any = undefined;

        if (useSsl) {
          const caPath =
            process.env.PGSSL_CA_PATH ||
            '/usr/local/share/ca-certificates/aws-rds-combined.crt';
          let caContent: string | undefined = undefined;
          try {
            if (caPath && fs.existsSync(caPath)) {
              caContent = fs.readFileSync(caPath, 'utf8');
            }
          } catch {}

          const rejectUnauthorizedEnv = configService.get<string>(
            'DB_SSL_REJECT_UNAUTHORIZED',
          );
          const rejectUnauthorized = rejectUnauthorizedEnv
            ? rejectUnauthorizedEnv !== 'false'
            : true;
          const servername = configService.get<string>('DB_SSL_SERVERNAME');

          const opts: any = { rejectUnauthorized };
          if (caContent) opts.ca = caContent;
          if (servername) opts.servername = servername;

          // If no CA provided, Node will use its trust store (augmented by NODE_EXTRA_CA_CERTS)
          sslOption = opts;
        }

        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USER', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'organization'),
          entities: [
            UserEntity,
            OrganizationEntity,
            ArtifactEntity,
            WorkflowEntity,
            OutboxEntity,
            OrganizationMembershipEntity,
            DemoSessionEntity,
            DemoAccountEntity,
            DemoRuntimeEntity,
            DemoEventEntity,
            DemoFeedbackEntity,
            DemoContributionEntity,
            DemoArtifactEditEntity,
          ],
          migrations: [
            CreateBaselineSchema1719999999000,
            AddOrganizationLedgerRouting1720000000000,
            CreateMessageOutbox1720000001000,
            CreateOrganizationMemberships1720000002000,
            AddRecordVisibility1720000003000,
            AddArtifactArchival1720000004000,
            CreateUsrse26Demo1720000005000,
            RestoreDemoArtifactPortal1720000006000,
            AddDemoAccounts1720000007000,
            AddMagneticArchShowcase1720000008000,
          ],
          migrationsRun:
            configService.get<string>(
              'DB_MIGRATIONS_RUN',
              process.env.NODE_ENV === 'production' ? 'true' : 'false',
            ) === 'true',
          synchronize:
            configService.get<string>(
              'DB_SYNCHRONIZE',
              process.env.NODE_ENV === 'production' ? 'false' : 'true',
            ) === 'true',
          keepConnectionAlive: true,
          ssl: sslOption,
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    DemoModule,
    ShowcaseModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
