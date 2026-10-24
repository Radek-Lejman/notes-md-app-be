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
import { clearAuthCookies, setAuthCookies } from '../utils/cookie.utils';
import { Throttle } from '@nestjs/throttler';
import { throttleAuthConfig } from '@security/config';
import { BruteForceGuard } from '@security';
import { PublicEndpoint } from '@common/decorators';

@Controller('/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly authService: AuthService) {}

  @PublicEndpoint()
  @Post('/register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.register(dto);

    setAuthCookies(res, accessToken, refreshToken);

    return { message: 'Registration successful ' };
  }

  @HttpCode(HttpStatus.OK)
  @PublicEndpoint()
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
    if (!user) return user;
    // The same fields as before session ids: `sid` names the refresh token and stays internal.
    const { sub, email, tokenVersion, iat, exp } = user;
    return { sub, email, tokenVersion, iat, exp };
  }

  @PublicEndpoint()
  @Post('/refresh')
  @Throttle({ option: throttleAuthConfig })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.refresh(req);
    setAuthCookies(res, accessToken, refreshToken);

    return { message: 'Token refreshed' };
  }

  @Post('/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req['user'];
    if (!user) throw new UnauthorizedException('User not found in request');

    // Logging out locally must work even when the database does not, so a failed revoke is
    // logged rather than returned; the refresh token then still expires on its own.
    await this.authService.logout(user).catch((err: unknown) => {
      this.logger.error(`Logout could not revoke the session: ${String(err)}`);
    });
    clearAuthCookies(res);

    return { message: 'Loged out' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('/revokeAll')
  async revokeAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req['user'];

    if (!user) {
      throw new UnauthorizedException('User not found in request');
    }

    // Clear the cookies only once revoking succeeded, so a failure is not reported as a logout.
    await this.authService.revokeAll(user.sub);
    clearAuthCookies(res);

    return { message: 'All refresh tokens revoked, logged out' };
  }
}
