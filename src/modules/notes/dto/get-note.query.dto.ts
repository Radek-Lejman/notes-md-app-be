import { ToInt } from '@common/transformers';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  DEFAULT_CHILDREN_LIMIT,
  DEFAULT_DEPTH,
  MAX_CHILDREN_LIMIT,
  MAX_DEPTH,
  MIN_CHILDREN_LIMIT,
  MIN_DEPTH,
} from '../consts/validator.consts';

export class GetNoteQueryDto {
  @IsOptional()
  @IsInt()
  @Min(MIN_DEPTH)
  @Max(MAX_DEPTH)
  @ToInt(DEFAULT_DEPTH)
  depth = DEFAULT_DEPTH;

  @IsOptional()
  @IsIn(['children', 'parent'])
  expand?: 'children' | 'parent';

  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsString()
  ['children.fields']?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_CHILDREN_LIMIT)
  @Max(MAX_CHILDREN_LIMIT)
  @ToInt(DEFAULT_CHILDREN_LIMIT)
  ['children.limit'] = DEFAULT_CHILDREN_LIMIT;

  @IsOptional()
  @IsString()
  ['children.cursor']?: string;

  @IsOptional()
  @IsIn(['createdAt', '-createdAt', 'updatedAt', '-updatedAt'])
  ['children.sort']?: 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt';
}
