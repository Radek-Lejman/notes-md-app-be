import { ToInt } from '@core/transformers';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetNoteQueryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  @ToInt(0)
  depth = 0;

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
  @Min(1)
  @Max(200)
  @ToInt(50)
  ['children.limit'] = 50;

  @IsOptional()
  @IsString()
  ['children.cursor']?: string;

  @IsOptional()
  @IsIn(['createdAt', '-createdAt', 'updatedAt', '-updatedAt'])
  ['children.sort']?: 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt';
}
