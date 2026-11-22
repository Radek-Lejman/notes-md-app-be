import { RerankWorkerConfig, RerankWorkerProcess, startRerankWorker } from './local-rerank.model';

// Entry point of the child process forked by LocalRerankProvider.
startRerankWorker(
  process as unknown as RerankWorkerProcess,
  JSON.parse(process.env.LOCAL_RERANK_CONFIG ?? '{}') as RerankWorkerConfig,
);
