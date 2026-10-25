import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MAX_CONTENT_LENGTH } from '../consts/validator.consts';
import {
  MAX_IMPORT_FILES,
  MAX_IMPORT_PATH_LENGTH,
  MAX_IMPORT_TITLE_LENGTH,
} from '../consts/import.consts';
import { normalizeMarkdown } from '../utils/normalizeMarkdown';
import { ImportMode, ImportReport } from '../import/planImport';

export class ImportFileDto {
  /** Relative path as the browser read it, e.g. "Projects/Docker.md". */
  @IsString()
  @MaxLength(MAX_IMPORT_PATH_LENGTH)
  path: string;

  @Transform(normalizeMarkdown)
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content: string;
}

export class ImportNotesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_FILES)
  @ValidateNested({ each: true })
  @Type(() => ImportFileDto)
  files: ImportFileDto[];

  /** In the body, not the query: the pipe does no implicit conversion of "false". */
  @IsBoolean()
  dryRun: boolean;

  /** Title of the import root note; default "Import YYYY-MM-DD". */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMPORT_TITLE_LENGTH)
  name?: string;

  /** An existing note of the user to put the import root under; none = top level. */
  @IsOptional()
  @IsUUID()
  targetParentId?: string;

  @IsOptional()
  @IsIn(['files', 'split-h1'])
  mode?: ImportMode;
}

export interface ImportResult extends ImportReport {
  dryRun: boolean;
  /** The created root note; null for a dry run. */
  rootNoteId: string | null;
}
