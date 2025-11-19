/**
 * Build a Postgres `tsquery` string from a free-text input using prefix matching.
 * - Splits on whitespace
 * - Strips characters that are not letters/digits/underscore/hyphen (Unicode aware)
 * - Converts each token to a prefix query: `${token}:*`
 * - Joins tokens with AND (`&`)
 *
 * Examples:
 *  input: "foo bar"  -> "foo:* & bar:*"
 *  input: "tes"      -> "tes:*"
 *
 * Returns `undefined` if no valid tokens remain.
 */
export function toTsQuery(input: string): string | undefined {
  const tokens = input
    .normalize('NFKC') // normalize Unicode
    .trim()
    .split(/\s+/)
    // keep only word-like chars; avoid injecting tsquery operators
    .map((w) => w.replace(/[^\p{L}\p{N}_-]+/gu, ''))
    .filter(Boolean);

  if (tokens.length === 0) return undefined;

  return tokens.map((w) => `${w}:*`).join(' & ');
}
