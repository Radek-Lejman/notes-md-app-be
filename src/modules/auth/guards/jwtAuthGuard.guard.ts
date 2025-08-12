import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtInnerService } from '../services/jwt.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly jwtService: JwtInnerService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.access_token;
    if (!token) throw new UnauthorizedException('Token does not exist');
    try {
      const payload = this.jwtService.verifyAccessToken(token);
      req['user'] = payload;
    } catch (e: unknown) {
      this.logger.error('Token authentication failed', { e });
      throw new UnauthorizedException(e);
    }
    this.logger.log('Token authentication success');

    return true;
  }
}
