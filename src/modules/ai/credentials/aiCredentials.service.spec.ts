import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { AgentProvider, LlmProvider } from '@ai';
import { PrismaService } from '@database/prisma';
import { SecretBox } from '@security';
import { AiCredentialsService } from './aiCredentials.service';
import { AiModuleConfig } from '../config/aiModule.config';

const SECRET = 'test-credentials-secret-0123456789abcdef';
const OAUTH = `sk-ant-oat01-${'a'.repeat(40)}WXYZ`;
const API_KEY = `sk-ant-api03-${'b'.repeat(40)}1234`;

describe('AiCredentialsService', () => {
  const aiCredential = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  };
  const user = { findUnique: jest.fn() };
  const prisma = { aiCredential, user } as unknown as PrismaService;
  const agent = { usesAccountAuth: true } as AgentProvider;
  const llm = { usesAccountAuth: false } as LlmProvider;
  const makeService = (serverLoginEmails: string[] = []) =>
    new AiCredentialsService(
      { credentialsSecret: SECRET, serverLoginEmails } as AiModuleConfig,
      agent,
      llm,
      prisma,
    );
  const box = new SecretBox(SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
    aiCredential.findUnique.mockResolvedValue(null);
    user.findUnique.mockResolvedValue({ email: 'Me@Example.com' });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('save', () => {
    beforeEach(() => {
      aiCredential.upsert.mockImplementation(({ create }: { create: object }) =>
        Promise.resolve({ ...create, updatedAt: new Date() }),
      );
    });

    it('stores the secret encrypted and bound to the user, with a short hint', async () => {
      const status = await makeService().save('user-1', 'claude-oauth-token', ` ${OAUTH} `);

      const [[{ create }]] = aiCredential.upsert.mock.calls as [
        [{ create: { userId: string; secret: string; hint: string } }],
      ];
      expect(create.userId).toBe('user-1');
      expect(create.secret).not.toContain(OAUTH);
      expect(box.decrypt(create.secret, 'user-1')).toBe(OAUTH);
      expect(create.hint).toBe('…WXYZ');
      expect(status).not.toHaveProperty('secret');
    });

    it.each([
      ['a line break', `${OAUTH.slice(0, 30)}\n${OAUTH.slice(30)}`],
      ['spaces and a tab', `${OAUTH.slice(0, 20)} \t${OAUTH.slice(20)}`],
      ['a no-break space', `${OAUTH.slice(0, 20)}\u00a0${OAUTH.slice(20)}`],
      ['zero-width characters', `\ufeff${OAUTH.slice(0, 20)}\u200b${OAUTH.slice(20)}\u200d`],
    ])('accepts a pasted token with %s inside', async (_case, pasted) => {
      await makeService().save('user-1', 'claude-oauth-token', pasted);

      const [[{ create }]] = aiCredential.upsert.mock.calls as [[{ create: { secret: string } }]];
      expect(box.decrypt(create.secret, 'user-1')).toBe(OAUTH);
    });

    it.each([
      ['claude-oauth-token', API_KEY, 'This is an Anthropic API key: choose that account type.'],
      [
        'anthropic-api-key',
        OAUTH,
        'This is a Claude subscription token: choose that account type.',
      ],
      [
        'claude-oauth-token',
        'not-a-token-at-all-but-long-enough',
        'This does not look like a Claude token (sk-ant-oat…). Run `claude setup-token`.',
      ],
      [
        'anthropic-api-key',
        'not-a-token-at-all-but-long-enough',
        'This does not look like an Anthropic API key (sk-ant-api…).',
      ],
    ] as const)('rejects a %s with a wrong format', async (type, secret, message) => {
      await expect(makeService().save('user-1', type, secret)).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(aiCredential.upsert).not.toHaveBeenCalled();
    });
  });

  describe('authForAgent', () => {
    it("returns the user's own token", async () => {
      aiCredential.findUnique.mockResolvedValue({
        type: 'claude-oauth-token',
        secret: box.encrypt(OAUTH, 'user-1'),
      });
      await expect(makeService().authForAgent('user-1')).resolves.toEqual({
        kind: 'claude-oauth-token',
        token: OAUTH,
      });
    });

    it("returns the user's own API key", async () => {
      aiCredential.findUnique.mockResolvedValue({
        type: 'anthropic-api-key',
        secret: box.encrypt(API_KEY, 'user-1'),
      });
      await expect(makeService().authForAgent('user-1')).resolves.toEqual({
        kind: 'anthropic-api-key',
        apiKey: API_KEY,
      });
    });

    it('rejects a credential encrypted for another user', async () => {
      aiCredential.findUnique.mockResolvedValue({
        type: 'claude-oauth-token',
        secret: box.encrypt(OAUTH, 'user-2'),
      });
      await expect(makeService().authForAgent('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('falls back to the server login for allowed emails (case-insensitive)', async () => {
      await expect(makeService(['me@example.com']).authForAgent('user-1')).resolves.toEqual({
        kind: 'server',
      });
    });

    it('requires a credential from everyone else', async () => {
      await expect(makeService(['other@example.com']).authForAgent('user-1')).rejects.toMatchObject(
        { response: { code: 'AI_CREDENTIALS_REQUIRED' } },
      );
    });
  });

  it('authForLlm does not need an account for a local provider', async () => {
    await expect(makeService().authForLlm('user-1')).resolves.toEqual({ kind: 'server' });
    expect(aiCredential.findUnique).not.toHaveBeenCalled();
  });

  it('agentNeedsAccount reflects the agent provider', () => {
    expect(makeService().agentNeedsAccount).toBe(true);
  });

  describe('canUseServerLogin', () => {
    it('is off without an allow-list, without querying the user', async () => {
      await expect(makeService().canUseServerLogin('user-1')).resolves.toBe(false);
      expect(user.findUnique).not.toHaveBeenCalled();
    });

    it('is off for a user that does not exist', async () => {
      user.findUnique.mockResolvedValue(null);
      await expect(makeService(['me@example.com']).canUseServerLogin('ghost')).resolves.toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns the type, hint and date of a saved credential', async () => {
      const updatedAt = new Date('2026-01-01');
      aiCredential.findUnique.mockResolvedValue({
        type: 'anthropic-api-key',
        hint: '…1234',
        updatedAt,
      });
      await expect(makeService().getStatus('user-1')).resolves.toEqual({
        type: 'anthropic-api-key',
        hint: '…1234',
        updatedAt,
      });
    });

    it('returns null when nothing is saved', async () => {
      await expect(makeService().getStatus('user-1')).resolves.toBeNull();
    });
  });

  it('getStatus never selects the secret', async () => {
    await makeService().getStatus('user-1');
    expect(aiCredential.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { type: true, hint: true, updatedAt: true },
    });
  });

  it('remove deletes only the given user credential', async () => {
    await makeService().remove('user-1');
    expect(aiCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
  });
});
