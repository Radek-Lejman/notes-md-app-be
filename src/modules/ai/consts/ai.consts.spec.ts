import { AI_CHAT_THROTTLE, AI_THROTTLE } from './ai.consts';
import { aiModuleConfig } from '../config/aiModule.config';

jest.mock('../config/aiModule.config', () => ({
  aiModuleConfig: jest.fn(() => ({ limits: { completePerMinute: 7, chatPerMinute: 42 } })),
}));

describe('AI throttle limits', () => {
  it('are read from the module config per request, not at import time', () => {
    expect(aiModuleConfig).not.toHaveBeenCalled();

    expect(AI_THROTTLE.global.limit()).toBe(7);
    expect(AI_CHAT_THROTTLE.global.limit()).toBe(42);
    expect(aiModuleConfig).toHaveBeenCalledTimes(2);
  });

  it('use a one-minute window', () => {
    expect(AI_THROTTLE.global.ttl).toBe(60_000);
    expect(AI_CHAT_THROTTLE.global.ttl).toBe(60_000);
  });
});
