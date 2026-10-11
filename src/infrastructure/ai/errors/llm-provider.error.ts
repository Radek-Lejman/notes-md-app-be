import { ServiceUnavailableException } from '@nestjs/common';

export class LlmProviderError extends ServiceUnavailableException {
  constructor(provider: string, reason: string) {
    super(`AI provider "${provider}" failed: ${reason}`);
  }
}

/** The provider could not be reached at all (down, network, timeout) — not a per-input failure. */
export class LlmProviderUnavailableError extends LlmProviderError {}
