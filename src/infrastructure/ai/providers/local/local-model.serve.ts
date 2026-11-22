import { WorkerProcess, WorkerRequest } from './local-model.ipc';

export interface ServeOptions<Model, Payload, Result> {
  /** Loads the model on the first request (and again after a failed load). */
  load: () => Promise<Model>;
  handle: (model: Model, request: WorkerRequest<Payload>) => Promise<Result>;
  /** Names the step in error messages, e.g. "embed". */
  operation: string;
}

/** Serves model requests from the parent process; exits when the parent goes away. */
export function serveModel<Model, Payload, Result>(
  proc: WorkerProcess<Payload, Result>,
  { load, handle, operation }: ServeOptions<Model, Payload, Result>,
): void {
  let loading: Promise<Model> | undefined;

  proc.on('message', (request) => {
    const { id } = request;
    void (async () => {
      let model: Model;
      try {
        model = await (loading ??= load());
      } catch (e) {
        loading = undefined; // retried on the next request
        proc.send({ id, error: `model load failed: ${(e as Error).message}`, unavailable: true });
        return;
      }
      try {
        proc.send({ id, ...(await handle(model, request)) });
      } catch (e) {
        proc.send({
          id,
          error: `${operation} failed: ${(e as Error).message}`,
          unavailable: false,
        });
      }
    })();
  });

  proc.on('disconnect', () => proc.exit(0));
}
