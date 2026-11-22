/**
 * Vault and dataset locations shared by rag-eval.ts and rag-dataset.ts: a flag wins over the
 * env (`~/.config/notes-app-be/rag-eval.env`); both are machine-specific, never in the repo.
 */
export const EVAL_PATH_OPTIONS = {
  vault: { type: 'string' },
  dataset: { type: 'string' },
} as const;

export function evalPaths(values: { vault?: string; dataset?: string }) {
  const vault = values.vault ?? process.env.RAG_EVAL_VAULT;
  if (!vault) throw new Error('Set RAG_EVAL_VAULT or pass --vault <dir>');
  const dataset = values.dataset ?? process.env.RAG_EVAL_DATASET;
  if (!dataset) throw new Error('Set RAG_EVAL_DATASET or pass --dataset <file|dir>');
  return { vault, dataset };
}
