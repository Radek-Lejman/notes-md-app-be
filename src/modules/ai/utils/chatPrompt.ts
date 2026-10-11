import { ChatMessageDto } from '../dto/chat.dto';
import { CurrentNote } from '../types/chat.types';
import { RagHit } from '../rag/rag.types';
import {
  CHAT_HISTORY_MAX_CHARS,
  CHAT_NOTE_CONTEXT_MAX_CHARS,
  CHAT_RAG_PROMPT,
  CHAT_SYSTEM_PROMPT,
} from '../consts/ai.consts';

export interface ChatPromptContext {
  currentNote?: CurrentNote;
  /** Semantic search is available (adds RAG guidance). */
  ragEnabled?: boolean;
  /** Fragments of other notes found for the question. */
  fragments?: RagHit[];
}

/** System prompt + context (current note, RAG fragments), all wrapped as data. */
export function buildChatSystemPrompt({
  currentNote,
  ragEnabled = false,
  fragments = [],
}: ChatPromptContext = {}): string {
  const parts = [CHAT_SYSTEM_PROMPT];
  if (ragEnabled) parts.push(CHAT_RAG_PROMPT);

  if (currentNote) {
    parts.push(
      '',
      `<current_note id="${currentNote.id}" title="${escapeAttr(currentNote.title)}">`,
      escapeData(currentNote.content.slice(0, CHAT_NOTE_CONTEXT_MAX_CHARS)),
      '</current_note>',
    );
  }

  if (fragments.length) {
    parts.push(
      '',
      '<relevant_note_fragments>',
      ...fragments.map(
        (f) =>
          `<fragment note_id="${f.noteId}" title="${escapeAttr(f.title)}" ` +
          `section="${escapeAttr(f.headingPath)}" score="${f.score.toFixed(2)}">\n` +
          `${escapeData(f.content)}\n</fragment>`,
      ),
      '</relevant_note_fragments>',
    );
  }

  return parts.join('\n');
}

/**
 * Agent providers take a single task, so the history is rendered as a transcript.
 * Keeps the newest messages that fit in CHAT_HISTORY_MAX_CHARS (always the last one).
 */
export function buildChatTask(messages: ChatMessageDto[]): string {
  const last = messages[messages.length - 1];
  const history: ChatMessageDto[] = [];
  let budget = CHAT_HISTORY_MAX_CHARS - last.content.length;

  for (let i = messages.length - 2; i >= 0 && messages[i].content.length <= budget; i--) {
    budget -= messages[i].content.length;
    history.unshift(messages[i]);
  }

  if (!history.length) return last.content;

  return [
    '<conversation_history>',
    ...history.map(({ role, content }) => `<${role}>\n${escapeData(content)}\n</${role}>`),
    '</conversation_history>',
    '',
    'Reply to the new user message, using the history above as context:',
    last.content,
  ].join('\n');
}

// Tags used to frame data in prompts. Data must not close them and smuggle in "instructions".
const FRAME_TAGS =
  /<(\/?)(current_note|relevant_note_fragments|fragment|conversation_history|user|assistant)\b/gi;

/** Neutralizes our framing tags inside user/note data. */
export function escapeData(value: string): string {
  return value.replace(FRAME_TAGS, '<​$1$2');
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, ' ');
}
