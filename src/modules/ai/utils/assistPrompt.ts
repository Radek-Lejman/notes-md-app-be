import { AssistAction, AssistDto } from '../dto/assist.dto';
import { escapeData } from './chatPrompt';

const TASKS: Record<Exclude<AssistAction, 'custom'>, string> = {
  explain: 'Explain the text simply and briefly, in the language of the text.',
  summarize: 'Summarize the text as a short bulleted list of the key points.',
  improve:
    'Rewrite the text to be clearer and more concise. Keep its meaning, language and markdown formatting.',
  fix: 'Fix spelling, grammar and punctuation. Change nothing else, keep the markdown formatting.',
  translate: 'Translate the text to English. If it is already in English, translate it to Polish.',
  continue:
    'Continue writing from where the text ends, in the same language, tone and style. ' +
    'Reply with the continuation only (one or two paragraphs), not with the original text.',
};

/** The user prompt for an assist run: the task, then the text wrapped as data. */
export function buildAssistPrompt({ action, text, instruction }: AssistDto): string {
  const task = action === 'custom' ? `Do what the user asks: ${instruction ?? ''}` : TASKS[action];

  const data = text
    ? ['<selected_text>', escapeData(text), '</selected_text>']
    : ['There is no text yet: write new content for the note.'];

  return [task, '', ...data].join('\n');
}

const WHOLE_FENCE = /^```[\w-]*\n([\s\S]*?)\n```$/;

/**
 * Models sometimes wrap the whole answer in a code fence despite the instructions. The fence is
 * kept when the text itself was a code block.
 */
export function cleanAssistAnswer(answer: string, text?: string): string {
  const trimmed = answer.trim();
  if (text?.trimStart().startsWith('```')) return trimmed;
  const fenced = WHOLE_FENCE.exec(trimmed);
  return fenced && !fenced[1].includes('```') ? fenced[1].trim() : trimmed;
}
