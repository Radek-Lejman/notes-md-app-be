import { z } from 'zod';
import { defineAgentTool } from './agent.types';

describe('defineAgentTool', () => {
  it('returns the same tool object', () => {
    const tool = {
      name: 't',
      description: 'd',
      inputSchema: { id: z.string() },
      handler: jest.fn(),
    };
    expect(defineAgentTool(tool)).toBe(tool);
  });
});
