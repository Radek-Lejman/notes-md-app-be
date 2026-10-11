import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AGENT_PROVIDER, AgentProvider, AI_CONFIG, AiConfig } from '@ai';
import { AuthUser } from '@security';
import { CurrentUser } from '@common/decorators';
import { AiCredentialsService } from '../credentials/aiCredentials.service';
import { AiRunLimiter } from '../credentials/aiRunLimiter.service';
import { CredentialStatus } from '../credentials/credential.types';
import { RagSearchService } from '../rag/ragSearch.service';
import { RagIndexStats } from '../rag/rag.types';
import { SaveCredentialDto } from '../dto/credentials.dto';
import { AI_CREDENTIALS_THROTTLE } from '../consts/ai.consts';

export interface AiSettingsResponse {
  provider: string;
  model: string;
  /** The provider bills a Claude account, so the user needs one connected. */
  requiresAccount: boolean;
  credential: CredentialStatus | null;
  /** The user may fall back to the server's own Claude login. */
  serverLoginAllowed: boolean;
  /** The user can chat right now. */
  ready: boolean;
  rag: { enabled: boolean; embeddingModel: string; stats: RagIndexStats | null };
}

export interface CredentialTestResponse {
  ok: boolean;
  message: string;
}

const TEST_TIMEOUT_MS = 60_000;

@Controller('/ai')
export class AiSettingsController {
  constructor(
    @Inject(AI_CONFIG) private readonly aiConfig: AiConfig,
    @Inject(AGENT_PROVIDER) private readonly agent: AgentProvider,
    private readonly credentials: AiCredentialsService,
    private readonly limiter: AiRunLimiter,
    private readonly ragSearch: RagSearchService,
  ) {}

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser): Promise<AiSettingsResponse> {
    const [credential, serverLoginAllowed, stats] = await Promise.all([
      this.credentials.getStatus(user.sub),
      this.credentials.canUseServerLogin(user.sub),
      this.ragSearch.enabled ? this.ragSearch.stats(user.sub) : Promise.resolve(null),
    ]);
    const requiresAccount = this.agent.usesAccountAuth;

    return {
      provider: this.agent.name,
      model: this.aiConfig.providers[this.agent.name].model,
      requiresAccount,
      credential,
      serverLoginAllowed,
      ready: !requiresAccount || !!credential || serverLoginAllowed,
      rag: { enabled: this.ragSearch.enabled, embeddingModel: this.ragSearch.model, stats },
    };
  }

  @Throttle(AI_CREDENTIALS_THROTTLE)
  @Put('credentials')
  saveCredential(
    @Body() dto: SaveCredentialDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CredentialStatus> {
    return this.credentials.save(user.sub, dto.type, dto.secret);
  }

  @Throttle(AI_CREDENTIALS_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('credentials')
  async removeCredential(@CurrentUser() user: AuthUser): Promise<void> {
    await this.credentials.remove(user.sub);
  }

  /** Tiny agent run (no tools) on the user's account: checks that the credential works. */
  @Throttle(AI_CREDENTIALS_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('credentials/test')
  async testCredential(@CurrentUser() user: AuthUser): Promise<CredentialTestResponse> {
    const auth = await this.credentials.authForAgent(user.sub);

    return this.limiter.run(user.sub, async () => {
      try {
        for await (const event of this.agent.run({
          task: 'Reply with exactly: OK',
          tools: [],
          auth,
          signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        })) {
          if (event.type === 'done') {
            return { ok: true, message: `Connected (${this.agent.name}).` };
          }
          if (event.type === 'error') return { ok: false, message: event.message };
        }
        return { ok: false, message: 'No answer from the AI provider.' };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    });
  }
}
