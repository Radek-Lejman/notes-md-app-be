import { Logger } from '@nestjs/common';
import { AgentEvent, AgentProvider, AgentRunRequest } from '@ai';
import { collect, streamOf } from '@ai/testing/ai-test.utils';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { AiAgentService } from './aiAgent.service';
import { AGENT_SYSTEM_PROMPT } from '../consts/ai.consts';
import { AiModuleConfig } from '../config/aiModule.config';
import { KEYWORD_SEARCH_PROMPT } from '../tools/keywordSearch.tool';

describe('AiAgentService', () => {
  const events: AgentEvent[] = [
    { type: 'tool_call', tool: 'search_notes', input: { query: 'ts' } },
    { type: 'done', text: 'answer', turns: 2, durationMs: 1 },
  ];
  const run = jest.fn<AsyncIterable<AgentEvent>, [AgentRunRequest]>();
  const searchByText = jest.fn().mockResolvedValue([]);
  const config = { agentKeywordSearch: false } as AiModuleConfig;
  const service = new AiAgentService(
    { name: 'ollama', run } as unknown as AgentProvider,
    { searchByText } as unknown as UserNotesService,
    config,
  );

  beforeEach(() => {
    run.mockReset().mockImplementation(() => streamOf(...events));
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs the agent with the system prompt, note tools and signal', async () => {
    const signal = new AbortController().signal;
    await collect(service.run('task', 'user-1', signal));

    const [request] = run.mock.calls[0];
    expect(request).toMatchObject({ task: 'task', systemPrompt: AGENT_SYSTEM_PROMPT, signal });
    expect(request.tools.map((t) => t.name)).toEqual(['search_notes', 'get_note', 'list_notes']);
  });

  it('passes provider events through unchanged', async () => {
    await expect(collect(service.run('task', 'user-1'))).resolves.toEqual(events);
  });

  it('binds the tools to the given user', async () => {
    await collect(service.run('task', 'user-1'));
    const [request] = run.mock.calls[0];

    await request.tools[0].handler({ query: 'ts' });

    expect(searchByText).toHaveBeenCalledWith('user-1', expect.anything());
  });

  it('uses the keyword search tool and its guidance when AI_AGENT_KEYWORD_SEARCH is on', async () => {
    config.agentKeywordSearch = true;
    try {
      await collect(service.run('task', 'user-1'));
      const [request] = run.mock.calls[0];

      expect(request.systemPrompt).toBe(`${AGENT_SYSTEM_PROMPT}\n${KEYWORD_SEARCH_PROMPT}`);
      await request.tools[0].handler({ keywords: ['ts'] });
      expect(searchByText).toHaveBeenCalledWith('user-1', expect.objectContaining({ q: 'ts' }));
    } finally {
      config.agentKeywordSearch = false;
    }
  });
});
