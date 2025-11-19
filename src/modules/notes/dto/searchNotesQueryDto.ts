import { IsInt, IsOptional, IsString, Max, Min, MinLength, IsIn } from 'class-validator';
import { ToInt } from '@common/transformers';
import {
  DEFAULT_CHILDREN_LIMIT,
  MAX_CHILDREN_LIMIT,
  MIN_CHILDREN_LIMIT,
  MIN_CONTENT_LENGTH,
} from '../consts/validator.consts';

export class SearchNotesQueryDto {
  @IsString()
  @MinLength(MIN_CONTENT_LENGTH)
  q!: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_CHILDREN_LIMIT)
  @Max(MAX_CHILDREN_LIMIT)
  @ToInt(DEFAULT_CHILDREN_LIMIT)
  limit = DEFAULT_CHILDREN_LIMIT;

  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsIn(['rank', '-rank', 'createdAt', '-createdAt', 'title', '-title', 'updatedAt', '-updatedAt'])
  order?:
    | 'rank'
    | '-rank'
    | 'createdAt'
    | '-createdAt'
    | 'title'
    | '-title'
    | 'updatedAt'
    | '-updatedAt';
}
