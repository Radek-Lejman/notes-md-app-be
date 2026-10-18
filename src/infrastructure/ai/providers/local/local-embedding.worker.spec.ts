jest.mock('./local-embedding.model', () => ({ startWorker: jest.fn() }));

describe('local-embedding.worker', () => {
  const original = process.env.LOCAL_EMBEDDING_CONFIG;
  afterEach(() => {
    process.env.LOCAL_EMBEDDING_CONFIG = original;
  });

  /** Runs the entry point and returns the startWorker mock it called. */
  const runWorker = () => {
    let startWorker!: jest.Mock;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports -- run the entry point */
      startWorker = (require('./local-embedding.model') as { startWorker: jest.Mock }).startWorker;
      require('./local-embedding.worker');
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    return startWorker;
  };

  it('starts the worker on this process with the config from its environment', () => {
    process.env.LOCAL_EMBEDDING_CONFIG = JSON.stringify({ model: 'm', cacheDir: '/models' });
    expect(runWorker()).toHaveBeenCalledWith(process, { model: 'm', cacheDir: '/models' });
  });

  it('falls back to an empty config', () => {
    delete process.env.LOCAL_EMBEDDING_CONFIG;
    expect(runWorker()).toHaveBeenCalledWith(process, {});
  });
});
