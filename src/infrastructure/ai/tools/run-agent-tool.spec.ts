import { z } from 'zod';
import { runAgentTool, toolInputJsonSchema } from './run-agent-tool';
import { AgentTool, defineAgentTool } from '../types/agent.types';

const makeTool = (handler: AgentTool['handler'], inputSchema: z.ZodRawShape = { id: z.string() }) =>
  defineAgentTool({ name: 't', description: 'test tool', inputSchema, handler });

describe('runAgentTool', () => {
  it('returns an error for an unknown tool', async () => {
    await expect(runAgentTool(undefined, {})).resolves.toEqual({
      text: 'Unknown tool',
      isError: true,
    });
  });

  it('rejects invalid input without calling the handler', async () => {
    const handler = jest.fn();
    const out = await runAgentTool(makeTool(handler), { id: 42 });

    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/^Invalid input:/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats missing input as {} (required field -> validation error)', async () => {
    const out = await runAgentTool(makeTool(jest.fn()), undefined);
    expect(out.isError).toBe(true);
  });

  it('treats missing input as {} (optional fields -> success)', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const out = await runAgentTool(makeTool(handler, { id: z.string().optional() }), undefined);

    expect(handler).toHaveBeenCalledWith({});
    expect(out).toEqual({ text: 'ok', isError: false });
  });

  it('returns string output as-is', async () => {
    const out = await runAgentTool(
      makeTool(() => Promise.resolve('plain')),
      { id: 'n1' },
    );
    expect(out).toEqual({ text: 'plain', isError: false });
  });

  it('serializes non-string output to JSON', async () => {
    const out = await runAgentTool(
      makeTool(() => Promise.resolve({ a: 1 })),
      { id: 'n1' },
    );
    expect(out).toEqual({ text: '{"a":1}', isError: false });
  });

  it('serializes a void handler result to "null" (never undefined text)', async () => {
    const out = await runAgentTool(
      makeTool(() => Promise.resolve(undefined)),
      { id: 'n1' },
    );
    expect(out).toEqual({ text: 'null', isError: false });
  });

  it('returns handler errors instead of throwing', async () => {
    const out = await runAgentTool(
      makeTool(() => Promise.reject(new Error('boom'))),
      { id: 'n1' },
    );
    expect(out).toEqual({ text: 'boom', isError: true });
  });

  it('strips keys not declared in the schema (e.g. injected userId)', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    await runAgentTool(makeTool(handler), { id: 'n1', userId: 'hack' });
    expect(handler).toHaveBeenCalledWith({ id: 'n1' });
  });
});

describe('toolInputJsonSchema', () => {
  it('returns JSON Schema without $schema', () => {
    const schema = toolInputJsonSchema(
      makeTool(jest.fn(), { query: z.string().describe('Search phrase') }),
    );

    expect(schema).not.toHaveProperty('$schema');
    expect(schema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', description: 'Search phrase' } },
      required: ['query'],
    });
  });
});
