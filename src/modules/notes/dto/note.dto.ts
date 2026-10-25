import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { NoteBase } from '../interfaces/notes.interface';
import { MAX_CONTENT_LENGTH, MIN_CONTENT_LENGTH } from '../consts/validator.consts';
import { normalizeMarkdown } from '../utils/normalizeMarkdown';

export class CreateNoteDto implements NoteBase {
  @IsString()
  @MinLength(MIN_CONTENT_LENGTH)
  title: string;

  @Transform(normalizeMarkdown)
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;
}

export class UpdateNoteDto extends PartialType(OmitType(CreateNoteDto, ['content'])) {
  // Optional, but not nullable: `@IsOptional()` would let `null` through to a NOT NULL column.
  @ValidateIf((dto: UpdateNoteDto) => dto.content !== undefined)
  @Transform(normalizeMarkdown)
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;
}
