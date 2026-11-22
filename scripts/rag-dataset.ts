/**
 * Label health of the RAG eval dataset against the vault on disk (no DB, no models).
 *
 *   npm run rag:dataset -- check              # stale / unpinned cases, type mix, gold coverage
 *   npm run rag:dataset -- pin                # pin hashes of cases that have none yet
 *   npm run rag:dataset -- pin --ids a,b      # re-pin AFTER you re-checked those stale cases
 *
 * Pinning rewrites the dataset files in place (`RAG_EVAL_DATASET`, outside the repo).
 */
import { parseArgs } from 'node:util';
import { readVault } from '../src/modules/ai/rag/eval/dataset/readVault';
import { datasetFiles, readDataset } from '../src/modules/ai/rag/eval/dataset/readDataset';
import { EvalCase, readJsonl, writeJsonl } from '../src/modules/ai/rag/eval/dataset/schema';
import {
  checkStaleness,
  hashVault,
  pinHashes,
  STALENESS,
} from '../src/modules/ai/rag/eval/dataset/staleness';
import { EVAL_PATH_OPTIONS, evalPaths } from './rag-eval/evalPaths';

const COMMAND = { check: 'check', pin: 'pin' } as const;

async function check(dataset: string, hashes: Map<string, string>) {
  const cases = await readDataset(dataset);
  const reviewed = cases.filter((c) => c.reviewed).length;
  console.log(
    `vault: ${hashes.size} files | dataset: ${cases.length} cases (${reviewed} reviewed)`,
  );

  const types = new Map<string, number>();
  for (const { type } of cases) types.set(type, (types.get(type) ?? 0) + 1);
  console.log(`types: ${[...types].map(([type, n]) => `${type}=${n}`).join(' ')}`);
  const covered = new Set(cases.flatMap((c) => c.gold.map((ref) => ref.note)));
  console.log(`vault files used as gold: ${covered.size}/${hashes.size}`);

  let problems = 0;
  for (const evalCase of cases) {
    const staleness = checkStaleness(evalCase, hashes);
    if (staleness.status === STALENESS.fresh) continue;
    problems++;
    const detail = staleness.status === STALENESS.stale ? JSON.stringify(staleness) : '';
    console.log(`  ${staleness.status.padEnd(9)} ${evalCase.id} ${detail}`);
  }
  console.log(problems ? `${problems} case(s) need attention` : 'all labels fresh');
}

async function pin(dataset: string, hashes: Map<string, string>, ids: Set<string> | null) {
  const wanted = (c: EvalCase) => (ids ? ids.has(c.id) : Object.keys(c.goldHashes).length === 0);
  let pinned = 0;
  for (const file of await datasetFiles(dataset)) {
    const cases = await readJsonl(file, EvalCase);
    if (!cases.some(wanted)) continue;
    pinned += cases.filter(wanted).length;
    await writeJsonl(
      file,
      cases.map((c) => (wanted(c) ? pinHashes(c, hashes) : c)),
    );
  }
  const unknown = ids ? ids.size - pinned : 0;
  console.log(`pinned ${pinned} case(s)${unknown ? `, ${unknown} id(s) not found` : ''}`);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { ...EVAL_PATH_OPTIONS, ids: { type: 'string' } },
  });
  const { vault, dataset } = evalPaths(values);
  const hashes = hashVault(await readVault(vault));

  const [command] = positionals;
  if (command === COMMAND.check) return check(dataset, hashes);
  if (command === COMMAND.pin) {
    const ids = values.ids ? new Set(values.ids.split(',')) : null;
    return pin(dataset, hashes, ids);
  }
  throw new Error('Usage: npm run rag:dataset -- check | pin [--ids a,b]');
}

main().catch((e) => {
  console.error('ERR', (e as Error).message);
  process.exit(1);
});
