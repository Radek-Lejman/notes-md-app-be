import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AGENT_PROVIDER, AgentProvider, AiAuth, LLM_PROVIDER, LlmProvider, SERVER_AUTH } from '@ai';
import { PrismaService } from '@database/prisma';
import { SecretBox } from '@security';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';
import {
  AI_ERROR_CODES,
  CREDENTIAL_FORMATS,
  CredentialStatus,
  CredentialType,
} from './credential.types';

const HINT_LENGTH = 4;

const WRONG_FORMAT: Record<CredentialType, string> = {
  'claude-oauth-token':
    'This does not look like a Claude token (sk-ant-oat…). Run `claude setup-token`.',
  'anthropic-api-key': 'This does not look like an Anthropic API key (sk-ant-api…).',
};

const WRONG_TYPE: Record<CredentialType, string> = {
  'claude-oauth-token': 'This is an Anthropic API key: choose that account type.',
  'anthropic-api-key': 'This is a Claude subscription token: choose that account type.',
};

const OTHER_TYPE: Record<CredentialType, CredentialType> = {
  'claude-oauth-token': 'anthropic-api-key',
  'anthropic-api-key': 'claude-oauth-token',
};

/** Why `value` is not a `type` credential; says so when it is the other type's secret. */
function formatError(type: CredentialType, value: string): string {
  if (CREDENTIAL_FORMATS[OTHER_TYPE[type]].test(value)) return WRONG_TYPE[type];
  return WRONG_FORMAT[type];
}

/**
 * Per-user Claude accounts: each user runs AI on their own subscription token or API key.
 * Secrets are encrypted at rest (bound to the user id) and never returned by the API.
 */
@Injectable()
export class AiCredentialsService {
  private readonly logger = new Logger(AiCredentialsService.name);
  private readonly box: SecretBox;

  constructor(
    @Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig,
    @Inject(AGENT_PROVIDER) private readonly agent: AgentProvider,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly prisma: PrismaService,
  ) {
    this.box = new SecretBox(config.credentialsSecret);
  }

  get agentNeedsAccount(): boolean {
    return this.agent.usesAccountAuth;
  }

  authForAgent(userId: string): Promise<AiAuth> {
    return this.resolve(userId, this.agent.usesAccountAuth);
  }

  authForLlm(userId: string): Promise<AiAuth> {
    return this.resolve(userId, this.llm.usesAccountAuth);
  }

  async getStatus(userId: string): Promise<CredentialStatus | null> {
    const row = await this.prisma.aiCredential.findUnique({
      where: { userId },
      select: { type: true, hint: true, updatedAt: true },
    });
    return row
      ? { type: row.type as CredentialType, hint: row.hint, updatedAt: row.updatedAt }
      : null;
  }

  async save(userId: string, type: CredentialType, secret: string): Promise<CredentialStatus> {
    // A token copied from a wrapped terminal line or a web page can carry line breaks, spaces or
    // invisible characters (zero-width, BOM); a real token has none of them.
    const value = secret.replace(/[\s\p{Cf}]/gu, '');
    if (!CREDENTIAL_FORMATS[type].test(value)) {
      throw new BadRequestException(formatError(type, value));
    }

    const data = {
      type,
      secret: this.box.encrypt(value, userId),
      hint: `…${value.slice(-HINT_LENGTH)}`,
    };
    const row = await this.prisma.aiCredential.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: { type: true, hint: true, updatedAt: true },
    });
    this.logger.log(`user=${userId} saved AI credential (${type})`);
    // Explicit fields: the secret never leaves this service, even if `select` changes.
    return { type, hint: row.hint, updatedAt: row.updatedAt };
  }

  async remove(userId: string): Promise<void> {
    await this.prisma.aiCredential.deleteMany({ where: { userId } });
    this.logger.log(`user=${userId} removed AI credential`);
  }

  async canUseServerLogin(userId: string): Promise<boolean> {
    if (!this.config.serverLoginEmails.length) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return !!user && this.config.serverLoginEmails.includes(user.email.toLowerCase());
  }

  /** Auth for a run on behalf of `userId`; throws 403 when they have no usable account. */
  private async resolve(userId: string, needsAccount: boolean): Promise<AiAuth> {
    if (!needsAccount) return SERVER_AUTH;

    const row = await this.prisma.aiCredential.findUnique({ where: { userId } });
    if (row) return this.toAuth(userId, row.type as CredentialType, row.secret);

    if (await this.canUseServerLogin(userId)) return SERVER_AUTH;

    throw new ForbiddenException({
      statusCode: 403,
      code: AI_ERROR_CODES.credentialsRequired,
      message: 'Connect your Claude account in AI settings to use the assistant.',
    });
  }

  private toAuth(userId: string, type: CredentialType, encrypted: string): AiAuth {
    let secret: string;
    try {
      secret = this.box.decrypt(encrypted, userId);
    } catch {
      // Usually AI_CREDENTIALS_SECRET was changed.
      this.logger.warn(`user=${userId} AI credential cannot be decrypted`);
      throw new ForbiddenException({
        statusCode: 403,
        code: AI_ERROR_CODES.credentialsInvalid,
        message: 'Your saved Claude credential is no longer valid. Save it again in AI settings.',
      });
    }
    return type === 'claude-oauth-token'
      ? { kind: 'claude-oauth-token', token: secret }
      : { kind: 'anthropic-api-key', apiKey: secret };
  }
}
