import ms from 'ms';

const createThrottleConfig = (ttl: string, limit: number) => ({
  ttl: ms(ttl),
  limit,
});

export const throttleGlobalConfig = createThrottleConfig('1m', 40);
export const throttleAuthConfig = createThrottleConfig('1m', 25);
