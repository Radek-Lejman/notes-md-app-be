import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PROMPT_LENGTH } from '../consts/ai.consts';

export class CompleteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROMPT_LENGTH)
  prompt: string;
}

export interface CompleteResponseDto {
  text: string;
  provider: string;
  model?: string;
  durationMs: number;
}
