// Import of many markdown files (docs/import/IMPORT-CONCEPT.md, item 5.1)
export const MAX_IMPORT_FILES = 2000;
export const MAX_IMPORT_PATH_LENGTH = 1024;

// Sum of `Buffer.byteLength(content, 'utf8')`, checked in the service.
export const MAX_IMPORT_TOTAL_BYTES = 15 * 1024 * 1024;

// Headroom over MAX_IMPORT_TOTAL_BYTES for JSON escaping and paths, so a valid payload gets a
// descriptive 400 rather than a 413.
export const IMPORT_BODY_LIMIT = '25mb';

export const MAX_IMPORT_TITLE_LENGTH = 200;

export const UNTITLED_NOTE_TITLE = 'Untitled';

// dryRun -> fixes -> dryRun -> import fits in a minute; every request may parse up to 25 MB.
export const IMPORT_THROTTLE = { global: { ttl: 60_000, limit: 5 } };
