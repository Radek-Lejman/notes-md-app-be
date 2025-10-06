import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BruteForceExceptionFilter } from './filters/brute-force-exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { BruteForceGuard } from './guards/bruteForce.guard';
import { bruteForceConfigRegitered } from './config/bruteForce.config';
import { BruteForceService } from './services/bruteForceService';

@Module({
  imports: [ConfigModule.forFeature(bruteForceConfigRegitered)],
  providers: [
    BruteForceService,
    BruteForceGuard,
    { provide: APP_FILTER, useClass: BruteForceExceptionFilter },
  ],
  exports: [BruteForceService, BruteForceGuard],
})
export class SecurityModule {}
