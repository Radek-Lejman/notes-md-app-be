import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PublicEndpoint } from '@common/decorators';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness probe for the hosting platform (e.g. Railway healthcheck): public, no database
   * access, reveals nothing but "the process answers HTTP". Not throttled, so frequent probes
   * never see a 429; both named throttlers must be listed, a bare @SkipThrottle() only skips
   * one called "default".
   */
  @PublicEndpoint()
  @SkipThrottle({ global: true, auth: true })
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
