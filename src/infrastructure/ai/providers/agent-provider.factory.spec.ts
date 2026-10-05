import { createAgentProvider } from './agent-provider.factory';
import { ClaudeAgentSdkProvider } from './claude-agent-sdk/claude-agent-sdk.provider';
import { OllamaAgentProvider } from './ollama/ollama-agent.provider';
import { makeAiConfig } from '../testing/ai-test.utils';
import { AgentProviderName } from '../types/agent.types';

describe('createAgentProvider', () => {
  it('creates the Claude Agent SDK provider', () => {
    expect(createAgentProvider(makeAiConfig({ agentProvider: 'claude-agent-sdk' }))).toBeInstanceOf(
      ClaudeAgentSdkProvider,
    );
  });

  it('creates the Ollama agent provider', () => {
    expect(createAgentProvider(makeAiConfig({ agentProvider: 'ollama' }))).toBeInstanceOf(
      OllamaAgentProvider,
    );
  });

  it('throws on an unsupported provider', () => {
    const config = makeAiConfig({ agentProvider: 'xyz' as AgentProviderName });
    expect(() => createAgentProvider(config)).toThrow('Unsupported AI_AGENT_PROVIDER: "xyz"');
  });
});
