import {
  Controller,
  Post,
  Get,
  Param,
  Delete,
  Req,
  UseGuards,
  UseInterceptors,
  Body,
  HttpCode,
  Put,
} from '@nestjs/common';
import { LocalAuthGuard } from '../auth/guards/local-auth/local-auth.guard';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';
import { Role } from 'src/shared/enums/role.enums';
import { Roles } from 'src/shared/decorators/roles.decorators';
import { UserService } from './user.service';
import { UserCreateDto } from './dto/userCreate.dto';
import { UserUpdateDto } from './dto/user-update.dto';
import { BusinessErrorsInterceptor } from 'src/shared/interceptors/business-errors.interceptors';
import { RolesGuard } from 'src/auth/roles/roles.guards';
import { Request } from 'express';
import { User } from '../auth/decorators/user.decorator';
import { UserEntity } from './user.entity';
import { IsUUID } from 'class-validator';

class SwitchOrganizationDto {
  @IsUUID('4')
  organizationId: string;
}

@Controller('users')
@UseInterceptors(BusinessErrorsInterceptor)
export class UserController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('/admins/check-admin-users')
  @Roles(Role.ADMIN)
  @HttpCode(200)
  async checkAdminUsers() {
    try {
      const users = await this.userService.findAll();
      const adminUsers = users.filter(
        (user) => user.roles && user.roles.includes('admin'),
      );
      return {
        message: 'Admin users found',
        count: adminUsers.length,
        users: adminUsers.map((user) => ({
          id: user.id,
          username: user.username,
          roles: user.roles,
        })),
      };
    } catch (error) {
      return {
        message: 'Error checking admin users',
        error: error.message,
      };
    }
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Req() req) {
    return this.authService.login(req);
  }

  @UseGuards(JwtAuthGuard)
  @Post('session/organization')
  async switchOrganization(
    @User() user: UserEntity,
    @Body() body: SwitchOrganizationDto,
  ) {
    return this.authService.switchOrganization(user.id, body.organizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    const token = req.headers.authorization;
    return this.authService.logout(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('register')
  async create(
    @Body() createUserDto: UserCreateDto,
    @User() creator: UserEntity,
  ) {
    return this.userService.create(createUserDto, creator);
  }

  @UseGuards(JwtAuthGuard)
  @Get('validate-token')
  @HttpCode(200)
  async validateToken(@User() user: UserEntity) {
    return { valid: true, userId: user.id };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  @Roles(Role.ADMIN, Role.PI)
  async findAll() {
    return this.userService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  @Roles(Role.ADMIN, Role.PI)
  async findOne(@Param('id') id: string) {
    return this.userService.findOneById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UserUpdateDto,
    @User() currentUser: UserEntity,
  ) {
    const result = await this.userService.update(
      id,
      updateUserDto,
      currentUser,
    );

    // If password was changed, return a message indicating re-login is required
    if ((result as any).requiresRelogin) {
      return {
        ...result,
        message:
          'Password updated successfully. Please log in again with your new credentials.',
      };
    }

    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  @Roles(Role.ADMIN, Role.PI)
  async remove(@Param('id') id: string, @User() currentUser: UserEntity) {
    return this.userService.remove(id, currentUser);
  }

  // Random test
}
