import { AgentEvent, AgentProvider, AgentRunRequest, AiAuth } from '@ai';
import { makeAiConfig, streamOf } from '@ai/testing/ai-test.utils';
import { AuthUser } from '@security';
import { AiSettingsController } from './aiSettings.controller';
import { AiCredentialsService } from '../credentials/aiCredentials.service';
import { AiRunLimiter } from '../credentials/aiRunLimiter.service';
import { CredentialStatus } from '../credentials/credential.types';
import { RagSearchService } from '../rag/ragSearch.service';
import { RagIndexStats } from '../rag/rag.types';

describe('AiSettingsController', () => {
  const auth: AiAuth = { kind: 'claude-oauth-token', token: 'tok' };
  const credential: CredentialStatus = {
    type: 'claude-oauth-token',
    hint: '…WXYZ',
    updatedAt: new Date('2026-01-01'),
  };
  const stats: RagIndexStats = { totalNotes: 3, indexedNotes: 2, chunks: 7 };
  const user = { sub: 'user-1' } as AuthUser;

  const getStatus = jest.fn<Promise<CredentialStatus | null>, [string]>();
  const canUseServerLogin = jest.fn<Promise<boolean>, [string]>();
  const save = jest.fn<Promise<CredentialStatus>, [string, string, string]>();
  const remove = jest.fn<Promise<void>, [string]>();
  const authForAgent = jest.fn<Promise<AiAuth>, [string]>();
  const ragStats = jest.fn<Promise<RagIndexStats>, [string]>();
  const run = jest.fn<AsyncIterable<AgentEvent>, [AgentRunRequest]>();
  const release = jest.fn();
  const acquire = jest.fn<() => void, [string]>();

  const makeController = ({ usesAccountAuth = true, ragEnabled = true } = {}) => {
    const limiter = { acquire } as unknown as AiRunLimiter;
    limiter.run = AiRunLimiter.prototype.run.bind(limiter) as AiRunLimiter['run'];
    return new AiSettingsController(
      makeAiConfig(),
      { name: 'claude-agent-sdk', usesAccountAuth, run } as AgentProvider,
      {
        getStatus,
        canUseServerLogin,
        save,
        remove,
        authForAgent,
      } as unknown as AiCredentialsService,
      limiter,
      { enabled: ragEnabled, model: 'bge-m3', stats: ragStats } as unknown as RagSearchService,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getStatus.mockResolvedValue(null);
    canUseServerLogin.mockResolvedValue(false);
    ragStats.mockResolvedValue(stats);
    authForAgent.mockResolvedValue(auth);
    acquire.mockReturnValue(release);
  });

  describe('getSettings', () => {
    it("describes the provider, the user's credential and the RAG index", async () => {
      getStatus.mockResolvedValue(credential);

      await expect(makeController().getSettings(user)).resolves.toEqual({
        provider: 'claude-agent-sdk',
        model: 'sonnet',
        requiresAccount: true,
        credential,
        serverLoginAllowed: false,
        ready: true,
        rag: { enabled: true, embeddingModel: 'bge-m3', stats },
      });
      expect(getStatus).toHaveBeenCalledWith('user-1');
      expect(canUseServerLogin).toHaveBeenCalledWith('user-1');
      expect(ragStats).toHaveBeenCalledWith('user-1');
    });

    it.each([
      // usesAccountAuth, credential, serverLogin, ready
      [true, null, false, false],
      [true, null, true, true],
      [true, credential, false, true],
      [false, null, false, true],
    ] as const)(
      'requiresAccount=%s, credential=%j, serverLogin=%s -> ready=%s',
      async (usesAccountAuth, saved, serverLogin, ready) => {
        getStatus.mockResolvedValue(saved);
        canUseServerLogin.mockResolvedValue(serverLogin);

        const settings = await makeController({ usesAccountAuth }).getSettings(user);
        expect(settings.ready).toBe(ready);
        expect(settings.requiresAccount).toBe(usesAccountAuth);
      },
    );

    it('does not query index stats when RAG is disabled', async () => {
      const settings = await makeController({ ragEnabled: false }).getSettings(user);

      expect(settings.rag).toEqual({ enabled: false, embeddingModel: 'bge-m3', stats: null });
      expect(ragStats).not.toHaveBeenCalled();
    });
  });

  it("saveCredential stores the secret on the current user's account", async () => {
    save.mockResolvedValue(credential);

    await expect(
      makeController().saveCredential(
        { type: 'claude-oauth-token', secret: 'sk-ant-oat01-x' },
        user,
      ),
    ).resolves.toBe(credential);
    expect(save).toHaveBeenCalledWith('user-1', 'claude-oauth-token', 'sk-ant-oat01-x');
  });

  it("removeCredential removes only the current user's credential", async () => {
    await expect(makeController().removeCredential(user)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith('user-1');
  });

  describe('testCredential', () => {
    const done: AgentEvent = { type: 'done', text: 'OK', turns: 1, durationMs: 5 };

    it("runs a tiny tool-less task on the user's account inside a limiter slot", async () => {
      run.mockImplementation(() => streamOf<AgentEvent>({ type: 'text', text: 'OK' }, done));

      await expect(makeController().testCredential(user)).resolves.toEqual({
        ok: true,
        message: 'Connected (claude-agent-sdk).',
      });

      const [request] = run.mock.calls[0];
      expect(request).toMatchObject({ task: 'Reply with exactly: OK', tools: [], auth });
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(authForAgent).toHaveBeenCalledWith('user-1');
      expect(acquire).toHaveBeenCalledWith('user-1');
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('reports a provider error event', async () => {
      run.mockImplementation(() =>
        streamOf<AgentEvent>({ type: 'error', message: 'Invalid bearer token' }),
      );

      await expect(makeController().testCredential(user)).resolves.toEqual({
        ok: false,
        message: 'Invalid bearer token',
      });
    });

    it('reports a run that ends without an answer', async () => {
      run.mockImplementation(() => streamOf<AgentEvent>());

      await expect(makeController().testCredential(user)).resolves.toEqual({
        ok: false,
        message: 'No answer from the AI provider.',
      });
    });

    it('reports a thrown error instead of failing the request, and frees the slot', async () => {
      run.mockImplementation(() => {
        throw new Error('spawn claude ENOENT');
      });

      await expect(makeController().testCredential(user)).resolves.toEqual({
        ok: false,
        message: 'spawn claude ENOENT',
      });
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not run when the user has no usable account', async () => {
      authForAgent.mockRejectedValue(new Error('credentials required'));

      await expect(makeController().testCredential(user)).rejects.toThrow('credentials required');
      expect(acquire).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });
  });
});
