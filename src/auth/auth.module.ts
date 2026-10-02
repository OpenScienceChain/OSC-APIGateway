import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { jwtConstants } from '../shared/security/constants';
import { UserModule } from '../user/user.module';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../user/user.entity';
import { TokenBlacklistService } from './token-blacklist.service';
import { SubmitterListenerAuthService } from './submitter-listener-auth.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth/api-key-auth.guard';
import { OrganizationMembershipEntity } from '../organization/organization-membership.entity';
import { OrganizationEntity } from '../organization/organization.entity';

@Module({
  imports: [
    forwardRef(() => UserModule),
    PassportModule,
    TypeOrmModule.forFeature([
      UserEntity,
      OrganizationEntity,
      OrganizationMembershipEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>(
          'JWT_SECRET',
          jwtConstants.JWT_SECRET,
        ),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_EXPIRES_IN',
            jwtConstants.JWT_EXPIRES_IN,
          ),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    PasswordService,
    TokenBlacklistService,
    SubmitterListenerAuthService,
    ApiKeyAuthGuard,
  ],
  exports: [
    AuthService,
    PasswordService,
    TokenBlacklistService,
    SubmitterListenerAuthService,
    ApiKeyAuthGuard,
  ],
})
export class AuthModule {}
