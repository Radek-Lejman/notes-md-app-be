import { IsOptional, IsString, MinLength } from 'class-validator';
import { NoteBase } from '../interfaces/notes.interface';

export class CreateNoteDto implements NoteBase {
  @IsString()
  @MinLength(2)
  title: string;
  @IsString()
  @MinLength(3)
  content: string;
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
