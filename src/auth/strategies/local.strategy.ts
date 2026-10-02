import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { Request } from 'express';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ passReqToCallback: true });
  }

  async validate(
    request: Request,
    username: string,
    password: string,
  ): Promise<any> {
    try {
      const requestedOrganizationId =
        request.body?.organizationId ||
        request.header('x-osc-organization') ||
        undefined;
      const user = await this.authService.validateUser(
        username,
        password,
        requestedOrganizationId,
      );
      return user;
    } catch (error) {
      throw new UnauthorizedException(error.message || 'Invalid credentials');
    }
  }
}
