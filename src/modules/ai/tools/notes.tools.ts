import { z } from 'zod';
import { AgentTool, defineAgentTool } from '@ai';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { GetNoteQueryDto } from 'src/modules/notes/dto/getNoteQuery.dto';
import { SearchNotesQueryDto } from 'src/modules/notes/dto/searchNotesQueryDto';
import { Note } from 'src/modules/notes/interfaces/notes.interface';
import { RagHit } from '../rag/rag.types';
import { AGENT_LIST_LIMIT, AGENT_NOTE_MAX_CHARS, AGENT_SEARCH_LIMIT } from '../consts/ai.consts';

export interface NoteRef {
  id: string;
  title: string;
}

export interface NotesToolsOptions {
  /** Called for every note the agent reads (get_note, semantic_search hits), e.g. for sources. */
  onNoteRead?: (note: NoteRef) => void;
  /** Adds the semantic_search tool (RAG), already bound to the user. */
  semanticSearch?: (query: string) => Promise<RagHit[]>;
}

/**
 * Read-only note tools for the agent.
 * `userId` is bound here from the JWT — the model never controls whose notes it reads.
 */
export function createNotesTools(
  notes: UserNotesService,
  userId: string,
  options: NotesToolsOptions = {},
): AgentTool[] {
  const tools = [
    defineAgentTool({
      name: 'search_notes',
      description:
        "Full-text search in the user's notes. Returns id, title and updatedAt of matching notes.",
      inputSchema: { query: z.string().min(2).describe('Search phrase') },
      handler: async ({ query }) => {
        const dto = Object.assign(new SearchNotesQueryDto(), {
          q: query,
          limit: AGENT_SEARCH_LIMIT,
          fields: 'title,updatedAt',
        });
        const found = await notes.searchByText(userId, dto);
        return found.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
      },
    }),

    defineAgentTool({
      name: 'get_note',
      description: 'Get a single note (title and markdown content) by its id.',
      inputSchema: { id: z.string().describe('Note id from search_notes') },
      handler: async ({ id }) => {
        const dto = Object.assign(new GetNoteQueryDto(), { fields: 'title,content' });
        const note = (await notes.getNoteById(id, dto, userId)) as Note | null;
        if (!note) throw new Error(`Note ${id} not found`);

        options.onNoteRead?.({ id: note.id, title: note.title });
        return {
          id: note.id,
          title: note.title,
          content: note.content.slice(0, AGENT_NOTE_MAX_CHARS),
        };
      },
    }),

    defineAgentTool({
      name: 'list_notes',
      description:
        "List the user's notes (id, title, parentId, updatedAt), most recently updated first. " +
        'Use it for overview questions or when search finds nothing.',
      inputSchema: {},
      handler: async () => {
        const all = (await notes.getAllNotes(userId)) ?? [];
        return all
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, AGENT_LIST_LIMIT)
          .map(({ id, title, parentId, updatedAt }) => ({ id, title, parentId, updatedAt }));
      },
    }),
  ];

  const { semanticSearch } = options;
  if (semanticSearch) {
    tools.push(
      defineAgentTool({
        name: 'semantic_search',
        description:
          "Semantic search in the user's notes: finds fragments by meaning (synonyms, other " +
          'languages, paraphrases). Returns noteId, title, section, the fragment text and a ' +
          'relevance score (0-1). Use get_note for the full note.',
        inputSchema: { query: z.string().min(2).describe('Question or topic to look for') },
        handler: async ({ query }) => {
          const hits = await semanticSearch(query);
          hits.forEach((hit) => options.onNoteRead?.({ id: hit.noteId, title: hit.title }));
          return hits.map((hit) => ({
            noteId: hit.noteId,
            title: hit.title,
            section: hit.headingPath,
            fragment: hit.content,
            score: Math.round(hit.score * 100) / 100,
          }));
        },
      }),
    );
  }

  return tools;
}
