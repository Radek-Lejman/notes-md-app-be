import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PROMPT_LENGTH } from '../consts/ai.consts';

export class AgentRunDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROMPT_LENGTH)
  task: string;
}
