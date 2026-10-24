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
import { JsonWebTokenError } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private readonly jwtService: AccessTokenService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      req['user'] = await this.jwtService.authenticate(token);
    } catch (e: unknown) {
      // A DB failure is a server fault, not a reason to log the user out.
      if (!(e instanceof JsonWebTokenError || e instanceof UnauthorizedException)) throw e;
      // Name and message only: the error object can carry the token or its payload.
      this.logger.warn(`Token authentication failed: ${e.name}: ${e.message}`);
      throw new UnauthorizedException('Invalid token');
    }
    this.logger.log('Token authentication success');

    return true;
  }
}
