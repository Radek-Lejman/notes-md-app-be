import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AGENT_PROVIDER, AgentProvider, AiAuth } from '@ai';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { GetNoteQueryDto } from 'src/modules/notes/dto/getNoteQuery.dto';
import { Note } from 'src/modules/notes/interfaces/notes.interface';
import { createNotesTools, NoteRef } from '../tools/notes.tools';
import { ChatDto } from '../dto/chat.dto';
import { ChatEvent, CurrentNote } from '../types/chat.types';
import { buildChatSystemPrompt, buildChatTask } from '../utils/chatPrompt';
import { RagSearchService } from '../rag/ragSearch.service';
import { RagHit } from '../rag/rag.types';
import { AI_MODULE_CONFIG, AiModuleConfig } from '../config/aiModule.config';

/**
 * Chat with the agent from inside a note: history + current note + RAG fragments as context,
 * all user notes reachable through tools.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    @Inject(AGENT_PROVIDER) private readonly agent: AgentProvider,
    @Inject(AI_MODULE_CONFIG) private readonly config: AiModuleConfig,
    private readonly userNotesService: UserNotesService,
    private readonly ragSearch: RagSearchService,
  ) {}

  /**
   * Prepares the context eagerly, so a wrong noteId fails as a regular 404
   * before the SSE stream starts. The returned stream is lazy.
   */
  async chat(
    dto: ChatDto,
    userId: string,
    auth: AiAuth,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatEvent>> {
    const currentNote = dto.noteId ? await this.loadNote(dto.noteId, userId) : undefined;
    const fragments = await this.findFragments(dto, userId, currentNote);
    return this.stream({ dto, userId, auth, currentNote, fragments, signal });
  }

  private async *stream(run: {
    dto: ChatDto;
    userId: string;
    auth: AiAuth;
    currentNote?: CurrentNote;
    fragments: RagHit[];
    signal?: AbortSignal;
  }): AsyncIterable<ChatEvent> {
    const { dto, userId, auth, currentNote, fragments, signal } = run;
    this.logger.log(
      `user=${userId} provider=${this.agent.name} auth=${auth.kind} ` +
        `note=${currentNote?.id ?? '-'} messages=${dto.messages.length} ` +
        `fragments=${fragments.length} chat started`,
    );

    const sources = new Map<string, NoteRef>();
    const addSource = (note: NoteRef) => sources.set(note.id, note);
    fragments.forEach((f) => addSource({ id: f.noteId, title: f.title }));

    const tools = createNotesTools(this.userNotesService, userId, {
      onNoteRead: addSource,
      semanticSearch: this.ragSearch.enabled
        ? (query) => this.ragSearch.search(userId, query)
        : undefined,
    });

    for await (const event of this.agent.run({
      task: buildChatTask(dto.messages),
      systemPrompt: buildChatSystemPrompt({
        currentNote,
        ragEnabled: this.ragSearch.enabled,
        fragments,
      }),
      tools,
      signal,
      auth,
    })) {
      if (event.type === 'done' && sources.size) {
        yield { type: 'sources', notes: [...sources.values()] };
      }
      yield event;
    }
  }

  /** Top RAG fragments for the question, excluding the current note (already in context). */
  private async findFragments(
    dto: ChatDto,
    userId: string,
    currentNote?: CurrentNote,
  ): Promise<RagHit[]> {
    const limit = this.config.rag.autoContextK;
    if (!this.ragSearch.enabled || !limit) return [];

    const question = dto.messages[dto.messages.length - 1].content;
    const hits = await this.ragSearch.searchSafe(userId, question, limit + 2);
    return hits.filter((hit) => hit.noteId !== currentNote?.id).slice(0, limit);
  }

  private async loadNote(noteId: string, userId: string): Promise<CurrentNote> {
    const query = Object.assign(new GetNoteQueryDto(), { fields: 'title,content' });
    const note = (await this.userNotesService.getNoteById(noteId, query, userId)) as Note | null;
    if (!note) throw new NotFoundException(`Note ${noteId} not found`);

    return { id: noteId, title: note.title, content: note.content };
  }
}
