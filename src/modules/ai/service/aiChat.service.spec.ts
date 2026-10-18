import { Logger, NotFoundException } from '@nestjs/common';
import { AgentEvent, AgentProvider, AgentRunRequest, AiAuth } from '@ai';
import { collect, streamOf } from '@ai/testing/ai-test.utils';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { AiChatService } from './aiChat.service';
import { ChatDto } from '../dto/chat.dto';
import { CHAT_RAG_PROMPT, CHAT_SYSTEM_PROMPT } from '../consts/ai.consts';
import { RagSearchService } from '../rag/ragSearch.service';
import { RagHit } from '../rag/rag.types';
import { AiModuleConfig } from '../config/aiModule.config';
import { KEYWORD_SEARCH_PROMPT } from '../tools/keywordSearch.tool';

describe('AiChatService', () => {
  const auth: AiAuth = { kind: 'server' };
  const run = jest.fn<AsyncIterable<AgentEvent>, [AgentRunRequest]>();
  const getNoteById = jest.fn();
  const rag = {
    enabled: false,
    search: jest.fn<Promise<RagHit[]>, [string, string, number?]>(),
    searchSafe: jest.fn<Promise<RagHit[]>, [string, string, number?]>(),
  };
  const config = { rag: { autoContextK: 2 } } as AiModuleConfig;
  const service = new AiChatService(
    { name: 'ollama', run } as unknown as AgentProvider,
    config,
    { getNoteById } as unknown as UserNotesService,
    rag as unknown as RagSearchService,
  );
  const done: AgentEvent = { type: 'done', text: 'answer', turns: 2, durationMs: 1 };
  const dto = (overrides: Partial<ChatDto> = {}): ChatDto => ({
    messages: [{ role: 'user', content: 'What is in my notes?' }],
    ...overrides,
  });
  const hit = (noteId: string, score = 0.8): RagHit => ({
    noteId,
    title: noteId.toUpperCase(),
    headingPath: `${noteId} > Part`,
    content: `fragment of ${noteId}`,
    score,
  });
  const lastRequest = () => run.mock.calls[0][0];
  const chatEvents = async (d = dto()) => collect(await service.chat(d, 'user-1', auth));

  beforeEach(() => {
    run.mockReset().mockImplementation(() => streamOf(done));
    getNoteById.mockReset();
    rag.enabled = false;
    rag.search.mockReset().mockResolvedValue([]);
    rag.searchSafe.mockReset().mockResolvedValue([]);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs the agent with the chat prompt, note tools, auth and signal', async () => {
    const signal = new AbortController().signal;
    const events = await collect(await service.chat(dto(), 'user-1', auth, signal));

    expect(events).toEqual([done]);
    expect(lastRequest()).toMatchObject({
      task: 'What is in my notes?',
      systemPrompt: CHAT_SYSTEM_PROMPT,
      signal,
      auth,
    });
    expect(lastRequest().tools.map((t) => t.name)).toEqual([
      'search_notes',
      'get_note',
      'list_notes',
    ]);
    expect(getNoteById).not.toHaveBeenCalled();
    expect(rag.searchSafe).not.toHaveBeenCalled();
  });

  it('adds the current note of the user to the system prompt', async () => {
    getNoteById.mockResolvedValue({ title: 'Deploy', content: '# Steps' });

    await chatEvents(dto({ noteId: 'n1' }));

    expect(getNoteById).toHaveBeenCalledWith('n1', expect.anything(), 'user-1');
    expect(lastRequest().systemPrompt).toContain('<current_note id="n1" title="Deploy">\n# Steps');
  });

  it('throws NotFound before running the agent when the note is missing', async () => {
    getNoteById.mockResolvedValue(null);

    await expect(service.chat(dto({ noteId: 'n1' }), 'user-1', auth)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('sends the notes read by get_note as sources right before done', async () => {
    getNoteById.mockResolvedValue({ id: 'n2', title: 'TS', content: 'x' });
    run.mockImplementation(async function* (request) {
      const getNote = request.tools.find((t) => t.name === 'get_note')!;
      await getNote.handler({ id: 'n2' });
      await getNote.handler({ id: 'n2' });
      yield { type: 'text', text: 'answer' };
      yield done;
    });

    await expect(chatEvents()).resolves.toEqual([
      { type: 'text', text: 'answer' },
      { type: 'sources', notes: [{ id: 'n2', title: 'TS' }] },
      done,
    ]);
  });

  it('does not send sources when the run fails', async () => {
    getNoteById.mockResolvedValue({ id: 'n2', title: 'TS', content: 'x' });
    run.mockImplementation(async function* (request) {
      await request.tools.find((t) => t.name === 'get_note')!.handler({ id: 'n2' });
      yield { type: 'error', message: 'Agent stopped' };
    });

    await expect(chatEvents()).resolves.toEqual([{ type: 'error', message: 'Agent stopped' }]);
  });

  describe('with keyword search (AI_AGENT_KEYWORD_SEARCH)', () => {
    beforeEach(() => {
      config.agentKeywordSearch = true;
    });

    afterEach(() => {
      config.agentKeywordSearch = false;
    });

    it('swaps search_notes for the keyword tool and adds its guidance', async () => {
      await collect(await service.chat(dto(), 'user-1', auth));

      expect(lastRequest().systemPrompt).toBe(`${CHAT_SYSTEM_PROMPT}\n${KEYWORD_SEARCH_PROMPT}`);
      const search = lastRequest().tools.find((t) => t.name === 'search_notes');
      expect(Object.keys(search!.inputSchema)).toEqual(['keywords']);
    });
  });

  describe('with RAG enabled', () => {
    beforeEach(() => {
      rag.enabled = true;
    });

    it('adds semantic_search bound to the user and the RAG guidance', async () => {
      rag.search.mockResolvedValue([hit('n7')]);
      await chatEvents();

      const semantic = lastRequest().tools.find((t) => t.name === 'semantic_search')!;
      await expect(semantic.handler({ query: 'deploy' })).resolves.toEqual([
        {
          noteId: 'n7',
          title: 'N7',
          section: 'n7 > Part',
          fragment: 'fragment of n7',
          score: 0.8,
        },
      ]);
      expect(rag.search).toHaveBeenCalledWith('user-1', 'deploy');
      expect(lastRequest().systemPrompt).toContain(CHAT_RAG_PROMPT);
    });

    it('puts the top fragments of other notes into the prompt and the sources', async () => {
      getNoteById.mockResolvedValue({ title: 'Current', content: 'c' });
      rag.searchSafe.mockResolvedValue([hit('n1'), hit('n2'), hit('n3'), hit('n4')]);

      const events = await chatEvents(dto({ noteId: 'n1' }));

      expect(rag.searchSafe).toHaveBeenCalledWith('user-1', 'What is in my notes?', 4);
      const prompt = lastRequest().systemPrompt!;
      expect(prompt).toContain('<relevant_note_fragments>');
      expect(prompt).toContain('fragment of n2');
      expect(prompt).toContain('fragment of n3');
      // current note is skipped, limit is autoContextK
      expect(prompt).not.toContain('fragment of n1');
      expect(prompt).not.toContain('fragment of n4');
      expect(events).toContainEqual({
        type: 'sources',
        notes: [
          { id: 'n2', title: 'N2' },
          { id: 'n3', title: 'N3' },
        ],
      });
    });
  });
});
