import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenService } from '../services/accessToken.service';
import { Reflector } from '@nestjs/core';
import { ENDPOINT_IS_PUBLIC_KEY } from '@common/decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private readonly jwtService: AccessTokenService,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(ENDPOINT_IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.access_token;
    if (!token) throw new UnauthorizedException('Token does not exist');
    try {
      const payload = this.jwtService.verifyAccessToken(token);
      req['user'] = payload;
    } catch (e: unknown) {
      this.logger.error('Token authentication failed', { e });
      throw new UnauthorizedException('Invalid token');
    }
    this.logger.log('Token authentication success');

    return true;
  }
}
