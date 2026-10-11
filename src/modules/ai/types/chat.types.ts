import { AgentEvent } from '@ai';
import { NoteRef } from '../tools/notes.tools';

/** Agent events plus chat-only ones. */
export type ChatEvent =
  | AgentEvent
  /** Notes the agent read while answering. Sent right before `done`. */
  | { type: 'sources'; notes: NoteRef[] };

export interface CurrentNote {
  id: string;
  title: string;
  content: string;
}
