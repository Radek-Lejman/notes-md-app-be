import { IsOptional, IsString, MinLength } from 'class-validator';
import { NoteBase } from '../interfaces/notes.interface';
import { MIN_CONTENT_LENGTH } from '../consts/validator.consts';

export class CreateNoteDto implements NoteBase {
  @IsString()
  @MinLength(MIN_CONTENT_LENGTH)
  title: string;
  @IsString()
  @MinLength(MIN_CONTENT_LENGTH)
  content: string;
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
