import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

export const QuestionType = z.enum([
  'fact', // single fact, one note
  'paraphrase', // answer in one note, but question shares almost no words with it
  'multi_hop', // needs >= 2 notes
  'aggregation', // list/summary spread across one long note or several notes
  'temporal', // "when / since when / what changed"
  'conflict', // notes contain contradicting claims - answer should surface the conflict
  'unanswerable', // notes do not contain the answer - system must abstain
]);
export type QuestionType = z.infer<typeof QuestionType>;

/**
 * Gold is labelled at note (+ optional heading) level, never chunk level:
 * chunk ids die with every chunking change, note paths survive.
 */
export const GoldRef = z.object({
  /** Vault path in the dataset; mapped to a note id before scoring. */
  note: z.string(),
  /** Optional: heading (any level) under which the answer lives. Enables section-level recall. */
  heading: z.string().optional(),
  /** 2 = primary (answer is here), 1 = supporting (useful context). Used by nDCG. */
  grade: z.union([z.literal(1), z.literal(2)]).default(2),
});
export type GoldRef = z.infer<typeof GoldRef>;

export const EvalCase = z
  .object({
    id: z.string(),
    question: z.string(),
    type: QuestionType,
    /** Empty for `unanswerable`. */
    gold: z.array(GoldRef),
    referenceAnswer: z.string(),
    /** Atomic facts a correct answer must contain - graded one by one, not as a 1-10 score. */
    keyFacts: z.array(z.string()),
    /** Claims a correct answer must NOT make (typical hallucinations, outdated values). */
    mustNotClaim: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    origin: z.enum(['seed', 'synthetic', 'human']),
    reviewed: z.boolean(),
    /** note path -> sha256 at labelling time. */
    goldHashes: z.record(z.string(), z.string()).default({}),
    createdAt: z.string(),
    notes: z.string().optional(),
  })
  // Without gold a case cannot be scored; only an unanswerable one is meant to have none.
  .refine((evalCase) => evalCase.type === 'unanswerable' || evalCase.gold.length > 0, {
    message: 'only unanswerable cases may have empty gold',
  });
export type EvalCase = z.infer<typeof EvalCase>;

const COMMENT_PREFIX = '//';

/** One JSON object per line; blank lines and `//` comments are skipped. A missing file = []. */
export async function readJsonl<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter(({ text }) => text && !text.startsWith(COMMENT_PREFIX))
    .map(({ text, line }) => {
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(`${file}:${line}: ${parsed.error.message}`);
      return parsed.data;
    });
}

/** One JSON object per line. Rewrites the file: `//` comments and unknown fields are dropped. */
export async function writeJsonl<T>(file: string, rows: T[]): Promise<void> {
  await writeFile(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
}
