/**
 * Build a Postgres `tsquery` string from a free-text input using prefix matching.
 * - Splits on whitespace
 * - Strips characters that are not letters/digits/underscore/hyphen (Unicode aware)
 * - Converts each token to a prefix query: `${token}:*`
 * - Joins tokens with AND (`&`), or with OR (`|`) in `any` mode
 *
 * Examples:
 *  input: "foo bar"  -> "foo:* & bar:*"
 *  input: "tes"      -> "tes:*"
 *
 * Tokens without a letter or digit (e.g. a lone "-") are dropped. In `any` mode (a natural
 * question, e.g. for hybrid RAG search) words shorter than 3 characters are dropped too:
 * with OR they would match almost every text ("na", "w", "i"). Upper-case two-letter
 * acronyms ("AI", "JS") are kept.
 * Returns `undefined` if no valid tokens remain.
 *
 * The result is meant for `to_tsquery` (which honours the `:*` prefix operator), not
 * `plainto_tsquery` (which drops it).
 */
const isAcronym = (word: string) => /^\p{Lu}[\p{Lu}\p{N}]$/u.test(word);

export function toTsQuery(input: string, mode: 'all' | 'any' = 'all'): string | undefined {
  const tokens = input
    .normalize('NFKC') // normalize Unicode
    .trim()
    .split(/\s+/)
    // keep only word-like chars; avoid injecting tsquery operators
    .map((w) => w.replace(/[^\p{L}\p{N}_-]+/gu, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .filter((w) => mode === 'all' || [...w].length >= 3 || isAcronym(w));

  if (tokens.length === 0) return undefined;

  return tokens.map((w) => `${w}:*`).join(mode === 'all' ? ' & ' : ' | ');
}
