/**
 * IPC protocol between a local model provider (local-model.client.ts) and its worker process
 * (local-model.serve.ts): one request, one answer, matched by id.
 */

export type WorkerRequest<Payload> = { id: number } & Payload;

export interface WorkerFailure {
  id: number;
  error: string;
  /** The model could not be loaded at all. */
  unavailable: boolean;
}

export type WorkerResponse<Result> = ({ id: number } & Result) | WorkerFailure;

/** The parts of `process` the worker uses (an IPC child). */
export interface WorkerProcess<Payload, Result> {
  on(event: 'message', listener: (message: WorkerRequest<Payload>) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  send(message: WorkerResponse<Result>): unknown;
  exit(code?: number): unknown;
}

export function isWorkerFailure<Result>(
  response: WorkerResponse<Result>,
): response is WorkerFailure {
  return 'error' in response;
}
