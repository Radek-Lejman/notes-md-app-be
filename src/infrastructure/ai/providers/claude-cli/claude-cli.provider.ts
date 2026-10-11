import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { LlmCompletionRequest, LlmCompletionResult, LlmProvider } from '../../types/llm.types';
import { ClaudeCliConfig } from '../../config/ai.config';
import { LlmProviderError } from '../../errors/llm-provider.error';
import { ClaudeCliJsonResult } from './claude-cli.types';
import { prepareClaudeEnv } from '../claude-auth';

/**
 * Calls Claude through the locally installed Claude Code CLI in headless mode
 * (`claude -p`). Auth per request (see prepareClaudeEnv): the user's own token/API key,
 * or the host CLI login.
 *
 * Dev/POC only: requires the `claude` binary + login on the host running the
 * backend, and spawns one process per request.
 */
export class ClaudeCliProvider implements LlmProvider {
  readonly name = 'claude-cli' as const;
  readonly usesAccountAuth = true;
  private readonly logger = new Logger(ClaudeCliProvider.name);

  constructor(private readonly config: ClaudeCliConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const model = request.model ?? this.config.model;
    const startedAt = Date.now();

    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
      // Pure text completion: no tools, no MCP, no user/project settings, no session files.
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence',
    ];
    if (request.systemPrompt) {
      args.push('--system-prompt', request.systemPrompt);
    }

    const { env, cleanup } = await prepareClaudeEnv(request.auth);
    let stdout: string;
    try {
      stdout = await this.run(args, request.prompt, env);
    } finally {
      await cleanup();
    }
    const parsed = this.parse(stdout);

    return {
      text: parsed.result ?? '',
      provider: this.name,
      model,
      durationMs: Date.now() - startedAt,
    };
  }

  private run(args: string[], stdin: string, env: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.bin, args, {
        env,
        cwd: tmpdir(), // keep the repo's CLAUDE.md / settings out of the context
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.config.timeoutMs,
      });

      // Decode as a stream so multi-byte UTF-8 chars split across chunks stay intact.
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: string) => (out += chunk));
      child.stderr.on('data', (chunk: string) => (err += chunk));

      child.on('error', (e) => reject(new LlmProviderError(this.name, e.message)));
      // EPIPE when the CLI exits before reading the prompt; 'close' reports the real failure.
      child.stdin.on('error', (e) => this.logger.warn(`stdin write failed: ${e.message}`));
      child.on('close', (code, signal) => {
        if (signal) {
          return reject(new LlmProviderError(this.name, `terminated (${signal}), timeout?`));
        }
        if (code !== 0) {
          this.logger.error(`claude exited with ${code}: ${err || out}`);
          return reject(new LlmProviderError(this.name, `exit code ${code}`));
        }
        resolve(out);
      });

      // Prompt via stdin: no argv length limits, no shell involved.
      child.stdin.end(stdin);
    });
  }

  private parse(stdout: string): ClaudeCliJsonResult {
    let parsed: ClaudeCliJsonResult;
    try {
      parsed = JSON.parse(stdout) as ClaudeCliJsonResult;
    } catch {
      throw new LlmProviderError(this.name, 'invalid JSON output');
    }
    if (parsed.is_error) {
      this.logger.error(`claude returned error: ${parsed.subtype} ${parsed.result ?? ''}`);
      throw new LlmProviderError(this.name, parsed.result ?? parsed.subtype);
    }
    return parsed;
  }
}
