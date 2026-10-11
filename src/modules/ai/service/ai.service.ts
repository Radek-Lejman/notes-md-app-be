import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiAuth, LLM_PROVIDER, LlmProvider } from '@ai';
import { CompleteResponseDto } from '../dto/complete.dto';
import { DEFAULT_SYSTEM_PROMPT } from '../consts/ai.consts';

/**
 * App-level AI use cases (prompt building, later: note context, summaries...).
 * Knows nothing about which vendor is behind LLM_PROVIDER.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}

  async complete(prompt: string, userId: string, auth?: AiAuth): Promise<CompleteResponseDto> {
    const result = await this.llm.complete({ prompt, systemPrompt: DEFAULT_SYSTEM_PROMPT, auth });
    this.logger.log(
      `user=${userId} provider=${result.provider} model=${result.model} ${result.durationMs}ms`,
    );
    return result;
  }
}
