import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { MAX_ASSIST_INSTRUCTION_LENGTH, MAX_ASSIST_TEXT_LENGTH } from '../consts/ai.consts';

export const ASSIST_ACTIONS = [
  'explain',
  'summarize',
  'improve',
  'fix',
  'translate',
  'continue',
  'custom',
] as const;
export type AssistAction = (typeof ASSIST_ACTIONS)[number];

export class AssistDto {
  @IsIn(ASSIST_ACTIONS)
  action: AssistAction;

  /**
   * The selected text, or the note text before the cursor when writing something new.
   * Only a custom instruction may come without it (e.g. "write an intro" in an empty note).
   */
  @ValidateIf((dto: AssistDto) => dto.action !== 'custom' || dto.text !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ASSIST_TEXT_LENGTH)
  text?: string;

  /** What to do with the text; required for (and only used by) the `custom` action. */
  @ValidateIf((dto: AssistDto) => dto.action === 'custom' || dto.instruction !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ASSIST_INSTRUCTION_LENGTH)
  instruction?: string;
}

export interface AssistResponseDto {
  /** Markdown to insert into the note. */
  text: string;
  provider: string;
  model?: string;
  durationMs: number;
}
