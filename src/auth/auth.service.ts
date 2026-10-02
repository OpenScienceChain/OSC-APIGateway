import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtConstants } from '../shared/security/constants';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { UserEntity } from '../user/user.entity';
import {
  BusinessError,
  BusinessLogicException,
} from '../shared/errors/business-errors';
import { PasswordService } from './password.service';
import { InjectRepository } from '@nestjs/typeorm';
import { UserService } from '../user/user.service';
import { TokenBlacklistService } from './token-blacklist.service';
import {
  MembershipStatus,
  OrganizationStatus,
} from '../organization/membership-status.enum';

interface AuthenticatedContext {
  id: string;
  username: string;
  email: string;
  roles: string[];
  membershipId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationMspId: string | null;
  organization: any;
  authVersion: number;
  platformAdmin: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly passwordService: PasswordService,
    private readonly userService: UserService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  async validateUser(
    username: string,
    password: string,
    requestedOrganizationId?: string,
  ): Promise<any> {
    try {
      // Use the authentication-specific method that includes the password
      const user = await this.userService.findOneForAuth(username);

      // Compare the provided password with the stored password
      const isMatch = await this.passwordService.comparePasswords(
        password,
        user.password,
      );

      if (isMatch) {
        const result = this.resolveAuthenticationContext(
          user,
          requestedOrganizationId,
        );
        delete (result as Partial<UserEntity>).password;
        return result;
      } else {
        throw new BusinessLogicException(
          'Invalid credentials',
          BusinessError.UNAUTHORIZED,
        );
      }
    } catch (error) {
      if (error instanceof BusinessLogicException) {
        throw error;
      }
      throw new BusinessLogicException(
        'Invalid credentials',
        BusinessError.UNAUTHORIZED,
      );
    }
  }

  private resolveAuthenticationContext(
    user: any,
    requestedOrganizationId?: string,
  ): AuthenticatedContext {
    const activeMemberships = (user.memberships || []).filter(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE &&
        membership.organization?.status !== OrganizationStatus.ARCHIVED,
    );

    let membership = requestedOrganizationId
      ? activeMemberships.find(
          (candidate) => candidate.organization?.id === requestedOrganizationId,
        )
      : activeMemberships.length === 1
        ? activeMemberships[0]
        : undefined;

    if (requestedOrganizationId && !membership) {
      throw new BusinessLogicException(
        'The selected organization membership is not active',
        BusinessError.UNAUTHORIZED,
      );
    }
    if (!requestedOrganizationId && activeMemberships.length > 1) {
      throw new BusinessLogicException(
        'An active organization must be selected',
        BusinessError.UNAUTHORIZED,
      );
    }
    if (!membership && user.organization) {
      membership = {
        id: null,
        roles: user.roles || [],
        organization: user.organization,
      };
    }
    if (!membership && !user.platformAdmin) {
      throw new BusinessLogicException(
        'The user has no active organization membership',
        BusinessError.UNAUTHORIZED,
      );
    }

    const organization = membership?.organization || null;
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: membership?.roles || [],
      membershipId: membership?.id || null,
      organizationId: organization?.id || null,
      organizationName: organization?.name || null,
      organizationMspId: organization?.mspId || null,
      organization,
      authVersion: user.authVersion || 0,
      platformAdmin: user.platformAdmin === true,
    };
  }

  async login(req: any) {
    const expiresIn = this.configService.get<string>(
      'JWT_EXPIRES_IN',
      jwtConstants.JWT_EXPIRES_IN,
    );
    const payload = {
      username: req.user.username,
      sub: req.user.id,
      roles: req.user.roles,
      email: req.user.email,
      membershipId: req.user.membershipId ?? null,
      organizationId: req.user.organizationId ?? null,
      organizationName: req.user.organizationName ?? null,
      organizationMspId: req.user.organizationMspId ?? null,
      authVersion: req.user.authVersion ?? 0,
      platformAdmin: req.user.platformAdmin === true,
    };
    return {
      token: this.jwtService.sign(payload, {
        secret: this.configService.get<string>(
          'JWT_SECRET',
          jwtConstants.JWT_SECRET,
        ),
        expiresIn,
      }),
    };
  }

  async switchOrganization(userId: string, organizationId: string) {
    const user = await this.userService.findOneForAuthById(userId);
    const context = this.resolveAuthenticationContext(user, organizationId);
    return this.login({ user: context });
  }

  /**
   * Log out a user by blacklisting their token
   * @param token The JWT token to blacklist
   * @returns A success message
   */
  async logout(token: string): Promise<{ message: string }> {
    // Add the token to the blacklist
    this.tokenBlacklistService.blacklistToken(token);

    // Return a success message
    return { message: 'Logout successful' };
  }
}
