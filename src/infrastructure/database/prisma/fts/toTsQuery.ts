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
 * Tokens without a letter or digit (e.g. a lone "-") are dropped.
 * Returns `undefined` if no valid tokens remain.
 *
 * The result is meant for `to_tsquery` (which honours the `:*` prefix operator), not
 * `plainto_tsquery` (which drops it).
 */
export function toTsQuery(input: string): string | undefined {
  const tokens = input
    .normalize('NFKC') // normalize Unicode
    .trim()
    .split(/\s+/)
    // keep only word-like chars; avoid injecting tsquery operators
    .map((w) => w.replace(/[^\p{L}\p{N}_-]+/gu, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));

  if (tokens.length === 0) return undefined;

  return tokens.map((w) => `${w}:*`).join(' & ');
}
