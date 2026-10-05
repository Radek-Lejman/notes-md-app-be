import { HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AgentEvent } from '@ai';
import { streamOf } from '@ai/testing/ai-test.utils';
import { AuthUser } from '@security';
import { AiController } from './ai.controller';
import { AiService } from '../service/ai.service';
import { AiAgentService } from '../service/aiAgent.service';

describe('AiController', () => {
  const complete = jest.fn<ReturnType<AiService['complete']>, Parameters<AiService['complete']>>();
  const run = jest.fn<AsyncIterable<AgentEvent>, Parameters<AiAgentService['run']>>();
  const controller = new AiController(
    { complete } as unknown as AiService,
    { run } as unknown as AiAgentService,
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

  const sse = (event: AgentEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    complete.mockReset();
    run.mockReset();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('complete: delegates to AiService with the current user', async () => {
    const result = { text: 'a', provider: 'ollama' as const, durationMs: 1 };
    complete.mockResolvedValue(result);

    await expect(controller.complete({ prompt: 'hi' }, user)).resolves.toBe(result);
    expect(complete).toHaveBeenCalledWith('hi', 'user-1');
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
  });

  it('agent: passes task, user and an abort signal that fires on client disconnect', async () => {
    streamEvents();
    const { handlers, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    const [task, userId, signal] = run.mock.calls[0];
    expect([task, userId]).toEqual(['task', 'user-1']);
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
  });

  it('agent: only ends the response when there are no events', async () => {
    streamEvents();
    const { res, asResponse } = makeRes();

    await controller.runAgent({ task: 'task' }, user, asResponse);

    expect(res.write).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
