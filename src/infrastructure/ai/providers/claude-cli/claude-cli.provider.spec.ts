jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

import { EventEmitter } from 'node:events';
import { spawn, SpawnOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Logger } from '@nestjs/common';
import { ClaudeCliProvider } from './claude-cli.provider';
import { ClaudeCliConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';

type FakeStream = EventEmitter & { setEncoding: jest.Mock };
type FakeChild = EventEmitter & {
  stdout: FakeStream;
  stderr: FakeStream;
  stdin: EventEmitter & { end: jest.Mock };
};

const fakeStream = (): FakeStream => Object.assign(new EventEmitter(), { setEncoding: jest.fn() });

const config: ClaudeCliConfig = { bin: '/bin/claude', model: 'sonnet', timeoutMs: 1234 };
const spawnMock = spawn as unknown as jest.Mock<FakeChild, [string, string[], SpawnOptions]>;

describe('ClaudeCliProvider', () => {
  let child: FakeChild;
  let errorLog: jest.SpyInstance;
  const provider = new ClaudeCliProvider(config);
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  /** Emits process output on the next tick, after the provider subscribed. */
  const finish = (opts: {
    stdout?: string[];
    stderr?: string;
    code?: number | null;
    signal?: string;
  }) =>
    process.nextTick(() => {
      (opts.stdout ?? []).forEach((chunk) => child.stdout.emit('data', chunk));
      if (opts.stderr) child.stderr.emit('data', opts.stderr);
      child.emit('close', opts.code ?? 0, opts.signal ?? null);
    });

  const json = (body: object) =>
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...body });
  const spawnArgs = () => spawnMock.mock.calls[0][1];

  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdout: fakeStream(),
      stderr: fakeStream(),
      stdin: Object.assign(new EventEmitter(), { end: jest.fn() }),
    });
    spawnMock.mockReset().mockReturnValue(child);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it('spawns a headless, tool-less claude and returns the result', async () => {
    finish({ stdout: [json({ result: 'Warszawa' })] });

    const result = await provider.complete({ prompt: 'Stolica Polski?' });

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/claude',
      [
        '-p',
        '--output-format',
        'json',
        '--model',
        'sonnet',
        '--tools',
        '',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--no-session-persistence',
      ],
      expect.objectContaining({ cwd: tmpdir(), timeout: 1234 }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith('Stolica Polski?');
    expect(result).toEqual({
      text: 'Warszawa',
      provider: 'claude-cli',
      model: 'sonnet',
      durationMs: expect.any(Number) as number,
    });
  });

  it('does not pass ANTHROPIC_API_KEY to the CLI (subscription auth)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-secret';
    finish({ stdout: [json({ result: 'ok' })] });

    await provider.complete({ prompt: 'x' });

    const { env } = spawnMock.mock.calls[0][2];
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-secret');
  });

  it('uses the model from the request', async () => {
    finish({ stdout: [json({ result: 'ok' })] });

    const result = await provider.complete({ prompt: 'x', model: 'opus' });

    expect(spawnArgs()).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(result.model).toBe('opus');
  });

  it('passes the system prompt only when given', async () => {
    finish({ stdout: [json({ result: 'ok' })] });
    await provider.complete({ prompt: 'x', systemPrompt: 'Be brief' });
    expect(spawnArgs().slice(-2)).toEqual(['--system-prompt', 'Be brief']);

    spawnMock.mockClear();
    finish({ stdout: [json({ result: 'ok' })] });
    await provider.complete({ prompt: 'x' });
    expect(spawnArgs()).not.toContain('--system-prompt');
  });

  it('concatenates stdout chunks', async () => {
    const out = json({ result: 'chunked' });
    finish({ stdout: [out.slice(0, 10), out.slice(10)] });

    await expect(provider.complete({ prompt: 'x' })).resolves.toMatchObject({ text: 'chunked' });
  });

  it('decodes output as a UTF-8 stream (multi-byte chars split across chunks)', async () => {
    finish({ stdout: [json({ result: 'ok' })] });

    await provider.complete({ prompt: 'x' });

    expect(child.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(child.stderr.setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('survives a stdin write error (EPIPE) and rejects via the exit code', async () => {
    const warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    process.nextTick(() => {
      child.stdin.emit('error', new Error('write EPIPE'));
      child.emit('close', 1, null);
    });

    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('exit code 1');
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining('EPIPE'));
  });

  it('returns empty text when result is missing', async () => {
    finish({ stdout: [json({})] });
    await expect(provider.complete({ prompt: 'x' })).resolves.toMatchObject({ text: '' });
  });

  it('rejects when the binary cannot be spawned', async () => {
    process.nextTick(() => child.emit('error', new Error('spawn claude ENOENT')));

    const promise = provider.complete({ prompt: 'x' });
    await expect(promise).rejects.toBeInstanceOf(LlmProviderError);
    await expect(promise).rejects.toThrow('ENOENT');
  });

  it('rejects when the process is killed (timeout)', async () => {
    finish({ code: null, signal: 'SIGTERM' });
    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow(
      'terminated (SIGTERM), timeout?',
    );
  });

  it('rejects on non-zero exit and logs stderr', async () => {
    finish({ code: 1, stderr: 'Not logged in' });

    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('exit code 1');
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
  });

  it('logs stdout on non-zero exit when stderr is empty', async () => {
    finish({ code: 2, stdout: ['partial output'] });

    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('exit code 2');
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('partial output'));
  });

  it('rejects on invalid JSON output', async () => {
    finish({ stdout: ['not json'] });
    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('invalid JSON output');
  });

  it('rejects with the CLI error result', async () => {
    finish({ stdout: [json({ is_error: true, subtype: 'error', result: 'Rate limited' })] });
    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('Rate limited');
  });

  it('rejects with the subtype when the error has no result', async () => {
    finish({ stdout: [json({ is_error: true, subtype: 'error_during_execution' })] });

    await expect(provider.complete({ prompt: 'x' })).rejects.toThrow('error_during_execution');
    expect(errorLog).toHaveBeenCalledWith('claude returned error: error_during_execution ');
  });
});
