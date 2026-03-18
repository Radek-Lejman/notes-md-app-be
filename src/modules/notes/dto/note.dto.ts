import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { NoteBase, TiptapNode } from '../interfaces/notes.interface';
import { MIN_CONTENT_LENGTH } from '../consts/validator.consts';




export class CreateNoteDto implements NoteBase {
  @IsString()
  @MinLength(MIN_CONTENT_LENGTH)
  title: string;
  @IsObject()
  content: TiptapNode;
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
