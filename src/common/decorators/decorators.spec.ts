import { CustomParamFactory } from '@nestjs/common/interfaces';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Request } from 'express';
import { makeHttpContext } from '@common/testing/http-test.utils';
import { CurrentUser, ENDPOINT_IS_PUBLIC_KEY, PublicEndpoint } from './index';

/** The factory Nest calls to resolve a custom param decorator. */
function paramFactory(decorator: () => ParameterDecorator): CustomParamFactory {
  class Probe {
    handler(@decorator() value: unknown) {
      return value;
    }
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: CustomParamFactory }
  >;
  return Object.values(args)[0].factory;
}

describe('CurrentUser', () => {
  it('resolves to the user the auth guard put on the request', () => {
    const user = { sub: 'user-1', email: 'a@example.com' };
    const factory = paramFactory(CurrentUser);

    expect(factory(undefined, makeHttpContext({ user } as Partial<Request>))).toBe(user);
  });

  it('is undefined on a request without a user', () => {
    expect(paramFactory(CurrentUser)(undefined, makeHttpContext({}))).toBeUndefined();
  });
});

describe('PublicEndpoint', () => {
  it('marks a handler as public under the key read by JwtAuthGuard', () => {
    class Probe {
      @PublicEndpoint()
      open(this: void) {}
      closed(this: void) {}
    }

    expect(Reflect.getMetadata(ENDPOINT_IS_PUBLIC_KEY, Probe.prototype.open)).toBe(true);
    expect(Reflect.getMetadata(ENDPOINT_IS_PUBLIC_KEY, Probe.prototype.closed)).toBeUndefined();
  });
});
