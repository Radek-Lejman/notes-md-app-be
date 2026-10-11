import { ExecutionContext } from '@nestjs/common';
import { Request, Response } from 'express';

/** Test helpers for guards, filters and decorators. Not used in production code. */

export type MockResponse = {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
};

export function makeResponse(): MockResponse {
  const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

/** HTTP ExecutionContext (also usable as ArgumentsHost) over the given request/response. */
export function makeHttpContext(
  req: Partial<Request>,
  res: MockResponse = makeResponse(),
  handler: () => void = () => undefined,
  cls: object = class {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as Request,
      getResponse: () => res as unknown as Response,
      getNext: () => undefined,
    }),
    getHandler: () => handler,
    getClass: () => cls,
    getType: () => 'http',
    getArgs: () => [req, res],
    getArgByIndex: (i: number) => [req, res][i],
    switchToRpc: () => {
      throw new Error('not rpc');
    },
    switchToWs: () => {
      throw new Error('not ws');
    },
  } as unknown as ExecutionContext;
}
