import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtConstants } from '../../shared/security/constants';
import { ConfigService } from '@nestjs/config';
import { TokenBlacklistService } from '../token-blacklist.service';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationMembershipEntity } from '../../organization/organization-membership.entity';
import { UserEntity } from '../../user/user.entity';
import {
  MembershipStatus,
  OrganizationStatus,
} from '../../organization/membership-status.enum';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(OrganizationMembershipEntity)
    private readonly membershipRepository: Repository<OrganizationMembershipEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        jwtConstants.JWT_SECRET,
      ),
      passReqToCallback: true, // Pass the request object to the validate method
    });
  }

  async validate(req: Request, payload: any) {
    // Extract the token from the request
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);

    // Check if the token is blacklisted
    if (this.tokenBlacklistService.isBlacklisted(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });
    if (!user || user.authVersion !== (payload.authVersion ?? 0)) {
      throw new UnauthorizedException('Token authorization is no longer valid');
    }

    if (!payload.membershipId) {
      if (!user.platformAdmin || payload.platformAdmin !== true) {
        throw new UnauthorizedException(
          'Active organization membership required',
        );
      }
      return {
        id: user.id,
        username: user.username,
        roles: [],
        email: user.email,
        membershipId: null,
        organizationId: null,
        organizationName: null,
        organizationMspId: null,
        organization: null,
        platformAdmin: true,
      };
    }

    const membership = await this.membershipRepository.findOne({
      where: { id: payload.membershipId, user: { id: user.id } },
      relations: ['organization'],
    });
    if (
      !membership ||
      membership.status !== MembershipStatus.ACTIVE ||
      membership.organization.status === OrganizationStatus.ARCHIVED
    ) {
      throw new UnauthorizedException('Organization membership is not active');
    }

    return {
      id: user.id,
      username: user.username,
      roles: membership.roles,
      email: user.email,
      membershipId: membership.id,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationMspId: membership.organization.mspId ?? null,
      organization: membership.organization,
      platformAdmin: user.platformAdmin,
    };
  }
}
