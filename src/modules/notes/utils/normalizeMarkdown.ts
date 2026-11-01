import { TransformFnParams } from 'class-transformer';

/** Same markdown no matter where it came from: no BOM, LF line endings. */
export const normalizeMarkdown = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') : value;
