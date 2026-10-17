import { z } from 'zod';
import { AgentTool, defineAgentTool } from '@ai';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { SearchNotesQueryDto } from 'src/modules/notes/dto/searchNotesQueryDto';
import { AGENT_SEARCH_LIMIT } from '../consts/ai.consts';

/**
 * Keyword search for the agent: a drop-in replacement of the basic `search_notes` tool.
 *
 * The basic tool runs one full-text query that needs every word and returns titles only, so a
 * whole question ("plan of the summer trip") often finds nothing. This one takes a few keywords,
 * runs one query per keyword (prefix match, e.g. "wakac" -> "wakacje"), ranks notes by how many
 * keywords they match and returns a snippet, so the model can pick notes without opening each.
 *
 * Switch: AI_AGENT_KEYWORD_SEARCH (default true). Off = the basic `search_notes` tool.
 * To remove the feature: delete this file and its spec, then remove the `keywordSearch` option
 * from createNotesTools (notes.tools.ts) and buildChatSystemPrompt (chatPrompt.ts), the two
 * places that pass it (aiChat.service.ts, aiAgent.service.ts), `agentKeywordSearch` in
 * aiModule.config.ts and AI_AGENT_KEYWORD_SEARCH in .env.example.
 */

export const MAX_KEYWORDS = 5;

export const KEYWORD_SEARCH_PROMPT = [
  'search_notes takes 1-5 short keywords, not a sentence. Each keyword matches the beginning of',
  'words, so prefer word stems that cover inflected forms (e.g. "wakac" for wakacje/wakacji).',
  'If nothing is found, try synonyms or related words; as a last resort use list_notes.',
].join('\n');

export interface KeywordSearchHit {
  id: string;
  title: string;
  updatedAt: Date;
  /** Text around the first match. */
  snippet: string;
  /** Keywords found in the note, most matched first in the result list. */
  matched: string[];
}

/** `userId` is bound here from the JWT; the model only chooses the keywords. */
export function createKeywordSearchTool(notes: UserNotesService, userId: string): AgentTool {
  return defineAgentTool({
    name: 'search_notes',
    description:
      "Keyword search in the user's notes (prefix match, case-insensitive). Returns id, title, " +
      'updatedAt, a snippet and the matched keywords, best matches first.',
    inputSchema: {
      keywords: z
        .array(z.string().trim().min(2))
        .min(1)
        .max(MAX_KEYWORDS)
        .describe('Short keywords or word stems, e.g. ["wakac", "morze"]'),
    },
    handler: async ({ keywords }) => searchByKeywords(notes, userId, keywords),
  });
}

export async function searchByKeywords(
  notes: UserNotesService,
  userId: string,
  keywords: string[],
): Promise<KeywordSearchHit[]> {
  const hits = new Map<string, KeywordSearchHit>();

  for (const keyword of new Set(keywords.map((k) => k.toLowerCase()))) {
    const dto = Object.assign(new SearchNotesQueryDto(), {
      q: keyword,
      limit: AGENT_SEARCH_LIMIT,
      fields: 'title,updatedAt',
    });

    for (const note of await notes.searchByText(userId, dto)) {
      const hit = hits.get(note.id);
      if (hit) {
        hit.matched.push(keyword);
      } else {
        hits.set(note.id, {
          id: note.id,
          title: note.title ?? '',
          updatedAt: note.updatedAt as Date,
          snippet: note.snippet,
          matched: [keyword],
        });
      }
    }
  }

  return [...hits.values()]
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length || b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .slice(0, AGENT_SEARCH_LIMIT);
}
