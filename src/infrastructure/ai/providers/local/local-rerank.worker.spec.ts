jest.mock('./local-rerank.model', () => ({ startRerankWorker: jest.fn() }));

describe('local-rerank.worker', () => {
  const original = process.env.LOCAL_RERANK_CONFIG;
  afterEach(() => {
    process.env.LOCAL_RERANK_CONFIG = original;
  });

  /** Runs the entry point and returns the startRerankWorker mock it called. */
  const runWorker = () => {
    let start!: jest.Mock;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports -- run the entry point */
      start = (require('./local-rerank.model') as { startRerankWorker: jest.Mock })
        .startRerankWorker;
      require('./local-rerank.worker');
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return start;
  };

  it('starts the worker on this process with the config from its environment', () => {
    process.env.LOCAL_RERANK_CONFIG = JSON.stringify({ model: 'm', cacheDir: '/models' });
    expect(runWorker()).toHaveBeenCalledWith(process, { model: 'm', cacheDir: '/models' });
  });

  it('falls back to an empty config', () => {
    delete process.env.LOCAL_RERANK_CONFIG;
    expect(runWorker()).toHaveBeenCalledWith(process, {});
  });
});
