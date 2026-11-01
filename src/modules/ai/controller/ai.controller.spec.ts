import { ForbiddenException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AgentEvent, AiAuth } from '@ai';
import { streamOf } from '@ai/testing/ai-test.utils';
import { AuthUser } from '@common';
import { AiController } from './ai.controller';
import { AiService } from '../service/ai.service';
import { AiAgentService } from '../service/aiAgent.service';
import { AiChatService } from '../service/aiChat.service';
import { AiCredentialsService } from '../credentials/aiCredentials.service';
import { AiRunLimiter } from '../credentials/aiRunLimiter.service';
import { ChatDto } from '../dto/chat.dto';
import { ChatEvent } from '../types/chat.types';

describe('AiController', () => {
  const auth: AiAuth = { kind: 'claude-oauth-token', token: 'tok' };
  const complete = jest.fn<ReturnType<AiService['complete']>, Parameters<AiService['complete']>>();
  const assist = jest.fn<ReturnType<AiService['assist']>, Parameters<AiService['assist']>>();
  const run = jest.fn<AsyncIterable<AgentEvent>, Parameters<AiAgentService['run']>>();
  const chat = jest.fn<ReturnType<AiChatService['chat']>, Parameters<AiChatService['chat']>>();
  const authForAgent = jest.fn<Promise<AiAuth>, [string]>();
  const authForLlm = jest.fn<Promise<AiAuth>, [string]>();
  const release = jest.fn();
  const acquire = jest.fn<() => void, [string]>();
  const limiter = { acquire } as unknown as AiRunLimiter;
  limiter.run = AiRunLimiter.prototype.run.bind(limiter) as AiRunLimiter['run'];

  const controller = new AiController(
    { complete, assist } as unknown as AiService,
    { run } as unknown as AiAgentService,
    { chat } as unknown as AiChatService,
    { authForAgent, authForLlm } as unknown as AiCredentialsService,
    limiter,
  );
  const user = { sub: 'user-1' } as AuthUser;

  const makeRes = () => {
    const handlers: Record<string, () => void> = {};
    const res = {
      status: jest.fn(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn<boolean, [string]>(),
      end: jest.fn(),
      on: jest.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
    };
    return { res, handlers, asResponse: res as unknown as Response };
  };

  const streamEvents = (...events: AgentEvent[]) =>
    run.mockImplementation(() => streamOf(...events));

  const sse = (event: ChatEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    authForAgent.mockResolvedValue(auth);
    authForLlm.mockResolvedValue(auth);
    acquire.mockReturnValue(release);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('complete: runs on the user account inside a limiter slot', async () => {
    const result = { text: 'a', provider: 'ollama' as const, durationMs: 1 };
    complete.mockResolvedValue(result);

    await expect(controller.complete({ prompt: 'hi' }, user)).resolves.toBe(result);
    expect(complete).toHaveBeenCalledWith('hi', 'user-1', auth);
    expect(acquire).toHaveBeenCalledWith('user-1');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('assist: runs on the user account inside a limiter slot', async () => {
    const result = { text: '- a', provider: 'claude' as const, durationMs: 1 };
    assist.mockResolvedValue(result);
    const dto = { action: 'summarize' as const, text: 'long text' };

    await expect(controller.assist(dto, user)).resolves.toBe(result);
    expect(assist).toHaveBeenCalledWith(dto, 'user-1', auth);
    expect(authForLlm).toHaveBeenCalledWith('user-1');
    expect(acquire).toHaveBeenCalledWith('user-1');
  });

  it('agent: streams events as SSE and ends the response', async () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', tool: 'search_notes', input: { query: 'ts' } },
      { type: 'done', text: 'answer', turns: 2, durationMs: 1 },
    ];
    streamEvents(...events);
    const { res, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.write.mock.calls.map(([chunk]) => chunk)).toEqual(events.map(sse));
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('agent: passes task, user, auth and an abort signal that fires on client disconnect', async () => {
    streamEvents();
    const { handlers, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    const [task, userId, signal, passedAuth] = run.mock.calls[0];
    expect([task, userId, passedAuth]).toEqual(['task', 'user-1', auth]);
    expect(signal?.aborted).toBe(false);
    handlers.close();
    expect(signal?.aborted).toBe(true);
  });

  it('agent: sends an error event when the stream fails mid-way', async () => {
    const first: AgentEvent = { type: 'text', text: 'partial' };
    run.mockImplementation(async function* () {
      yield await Promise.resolve(first);
      throw new Error('provider down');
    });
    const { res, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    expect(res.write.mock.calls.map(([chunk]) => chunk)).toEqual([
      sse(first),
      sse({ type: 'error', message: 'Agent failed' }),
    ]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('provider down'));
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('agent: only ends the response when there are no events', async () => {
    streamEvents();
    const { res, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  describe('chat', () => {
    const dto: ChatDto = { messages: [{ role: 'user', content: 'hi' }], noteId: 'n1' };

    it('streams chat events (incl. sources) as SSE', async () => {
      const events: ChatEvent[] = [
        { type: 'text_delta', text: 'an' },
        { type: 'sources', notes: [{ id: 'n1', title: 'TS' }] },
        { type: 'done', text: 'answer', turns: 1, durationMs: 1 },
      ];
      chat.mockResolvedValue(streamOf(...events));
      const { res, asResponse } = makeRes();

      await controller.chat(dto, user, asResponse);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.write.mock.calls.map(([chunk]) => chunk)).toEqual(events.map(sse));
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('passes dto, user, auth and an abort signal that fires on client disconnect', async () => {
      chat.mockResolvedValue(streamOf());
      const { handlers, asResponse } = makeRes();

      await controller.chat(dto, user, asResponse);

      const [passedDto, userId, passedAuth, signal] = chat.mock.calls[0];
      expect([passedDto, userId, passedAuth]).toEqual([dto, 'user-1', auth]);
      handlers.close();
      expect(signal?.aborted).toBe(true);
    });

    it('rejects with 403 before taking a slot when the user has no AI account', async () => {
      authForAgent.mockRejectedValue(new ForbiddenException());
      const { res, asResponse } = makeRes();

      await expect(controller.chat(dto, user, asResponse)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(acquire).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect(res.flushHeaders).not.toHaveBeenCalled();
    });

    it('rejects before opening the stream and frees the slot when the service fails', async () => {
      chat.mockRejectedValue(new Error('Note n1 not found'));
      const { res, asResponse } = makeRes();

      await expect(controller.chat(dto, user, asResponse)).rejects.toThrow('Note n1 not found');
      expect(res.flushHeaders).not.toHaveBeenCalled();
      expect(res.write).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not run when the limiter refuses a slot', async () => {
      acquire.mockImplementation(() => {
        throw new Error('busy');
      });
      const { asResponse } = makeRes();

      await expect(controller.chat(dto, user, asResponse)).rejects.toThrow('busy');
      expect(chat).not.toHaveBeenCalled();
    });
  });
});
