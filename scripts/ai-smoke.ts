/**
 * Smoke test for AI providers — no DB, no HTTP, no login needed.
 * Uses the real provider factories + config (env), with mocked note tools.
 *
 *   npm run ai:smoke                      # complete + agent
 *   npm run ai:smoke -- complete "Twój prompt"
 *   npm run ai:smoke -- agent "Twoje zadanie"
 *
 * Provider is picked by env, e.g.:
 *   AI_PROVIDER=ollama AI_AGENT_PROVIDER=ollama npm run ai:smoke
 */
import { z } from 'zod';
import { loadAiConfig } from '../src/infrastructure/ai/config/ai.config';
import { createLlmProvider } from '../src/infrastructure/ai/providers/llm-provider.factory';
import { createAgentProvider } from '../src/infrastructure/ai/providers/agent-provider.factory';
import { defineAgentTool } from '../src/infrastructure/ai/types/agent.types';
import { AGENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from '../src/modules/ai/consts/ai.consts';

const MOCK_NOTES = [
  {
    id: 'n1',
    title: 'TypeScript generics',
    content: 'Generyki: <T>(x: T) => T. Do powtórki: conditional types, infer.',
  },
  { id: 'n2', title: 'Zakupy', content: 'Mleko, chleb, kawa.' },
];

const mockTools = [
  defineAgentTool({
    name: 'search_notes',
    description: "Full-text search in the user's notes. Returns id and title of matching notes.",
    inputSchema: { query: z.string().min(2).describe('Search phrase') },
    handler: () => Promise.resolve(MOCK_NOTES.map(({ id, title }) => ({ id, title }))),
  }),
  defineAgentTool({
    name: 'get_note',
    description: 'Get a single note (title and plain-text content) by its id.',
    inputSchema: { id: z.string().describe('Note id from search_notes') },
    handler: ({ id }) => {
      const note = MOCK_NOTES.find((n) => n.id === id);
      return note ? Promise.resolve(note) : Promise.reject(new Error(`Note ${id} not found`));
    },
  }),
];

async function runComplete(prompt: string) {
  const config = loadAiConfig();
  console.log(`\n--- complete (${config.llmProvider}) ---`);
  const result = await createLlmProvider(config).complete({
    prompt,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  console.log(result);
}

async function runAgent(task: string) {
  const config = loadAiConfig();
  console.log(`\n--- agent (${config.agentProvider}) ---`);
  const events = createAgentProvider(config).run({
    task,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    tools: mockTools,
  });
  for await (const event of events) {
    console.log(event);
  }
}

async function main() {
  const [mode = 'all', input] = process.argv.slice(2);

  if (mode === 'complete' || mode === 'all') {
    await runComplete(input ?? 'Wyjaśnij w 1 zdaniu, czym jest RAG.');
  }
  if (mode === 'agent' || mode === 'all') {
    await runAgent(input ?? 'Co mam do powtórki z TypeScripta?');
  }
}

main().catch((e) => {
  console.error('ERR', (e as Error).message);
  process.exit(1);
});
