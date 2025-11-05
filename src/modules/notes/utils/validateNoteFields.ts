import { BadRequestException } from '@nestjs/common';
import { ALLOWED_NOTE_FIELDS } from '../consts/allowedNoteFields';
import { fromStringToArray } from '@core/utils';

export function validateAndNormalizeFields<TAllowed extends readonly string[]>(
  raw: string | undefined,
  paramName: string = 'fields',
): readonly TAllowed[number][] {
  const list = fromStringToArray(raw) ?? [];
  for (const field of list) {
    if (!(ALLOWED_NOTE_FIELDS as readonly string[]).includes(field)) {
      throw new BadRequestException(
        `Forbidden field "${field}" requested in '${paramName}' query param`,
      );
    }
  }
  return Array.from(new Set(list)) as readonly TAllowed[number][];
}
