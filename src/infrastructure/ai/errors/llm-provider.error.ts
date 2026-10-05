import { ServiceUnavailableException } from '@nestjs/common';

export class LlmProviderError extends ServiceUnavailableException {
  constructor(provider: string, reason: string) {
    super(`AI provider "${provider}" failed: ${reason}`);
  }
}
