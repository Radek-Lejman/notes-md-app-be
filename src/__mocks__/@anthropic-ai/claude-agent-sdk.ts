/**
 * Jest manual mock (auto-applied): the real SDK is ESM-only and spawns Claude Code,
 * so unit tests never load it. Tests drive `query` via mockImplementation.
 */
export const query = jest.fn();

export const tool = jest.fn(
  (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
);

export const createSdkMcpServer = jest.fn((options: unknown) => options);
