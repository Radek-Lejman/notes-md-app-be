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
      ['claude-oauth-token', API_KEY],
      ['anthropic-api-key', OAUTH],
      ['claude-oauth-token', 'not-a-token-at-all-but-long-enough'],
    ] as const)('rejects a %s with a wrong format', async (type, secret) => {
      await expect(makeService().save('user-1', type, secret)).rejects.toBeInstanceOf(
        BadRequestException,
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
