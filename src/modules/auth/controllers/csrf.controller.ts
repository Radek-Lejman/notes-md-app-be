import { PublicEndpoint } from '@common/decorators';
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller('csrf-token')
export class CsrfController {
  @PublicEndpoint()
  @Get()
  getToken(@Req() req: Request) {
    return { csrfToken: req.csrfToken() };
  }
}
