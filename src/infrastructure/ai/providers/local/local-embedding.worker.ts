import { startWorker, WorkerConfig, WorkerProcess } from './local-embedding.model';

// Entry point of the child process forked by LocalEmbeddingProvider.
startWorker(
  process as unknown as WorkerProcess,
  JSON.parse(process.env.LOCAL_EMBEDDING_CONFIG ?? '{}') as WorkerConfig,
);
