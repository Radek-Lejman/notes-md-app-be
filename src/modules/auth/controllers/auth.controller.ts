import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Request as Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { AuthService } from '../services/auth.service';
import { JwtAuthGuard } from '../guards/jwtAuthGuard.guard';
import { setAuthCookies } from '../utils/cookie.utils';
import { Throttle } from '@nestjs/throttler';
import { throttleAuthConfig } from '@security/config';
import { BruteForceGuard } from '@security';

@Controller('/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly authService: AuthService) {}
  @Post('/register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.register(dto);

    setAuthCookies(res, accessToken, refreshToken);

    return { message: 'Registration successful ' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('/login')
  @UseGuards(BruteForceGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.login(dto, req.__bfKeys ?? []);
    setAuthCookies(res, accessToken, refreshToken);
    return { message: 'Login successful' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('/me')
  me(@Req() req: Request) {
    const user = req['user'];
    return user;
  }

  @Post('/refresh')
  @Throttle({ option: throttleAuthConfig })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.refresh(req);
    setAuthCookies(res, accessToken, refreshToken);

    return { message: 'Token refreshed' };
  }

  @Post('/logout')
  logout(@Res({ passthrough: true }) res: Response) {
    setAuthCookies(res, '', '');

    return { message: 'Loged out' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('/revokeAll')
  revokeAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req['user'];

    if (!user) {
      throw new UnauthorizedException('User not found in request');
    }

    this.authService.revokeAll(user.sub);
    setAuthCookies(res, '', '');

    return { message: 'All refresh tokens revoked, logged out' };
  }
}
