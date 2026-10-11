import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_PROVIDER, AgentEvent, AgentProvider, AiAuth } from '@ai';
import { UserNotesService } from 'src/modules/notes/service/userNotes.service';
import { createNotesTools } from '../tools/notes.tools';
import { AGENT_SYSTEM_PROMPT } from '../consts/ai.consts';

/**
 * Agent use cases: picks tools + system prompt for the current user.
 * Knows nothing about which vendor is behind AGENT_PROVIDER.
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    @Inject(AGENT_PROVIDER) private readonly agent: AgentProvider,
    private readonly userNotesService: UserNotesService,
  ) {}

  async *run(
    task: string,
    userId: string,
    signal?: AbortSignal,
    auth?: AiAuth,
  ): AsyncIterable<AgentEvent> {
    this.logger.log(
      `user=${userId} provider=${this.agent.name} auth=${auth?.kind ?? 'server'} agent run started`,
    );

    yield* this.agent.run({
      task,
      systemPrompt: AGENT_SYSTEM_PROMPT,
      tools: createNotesTools(this.userNotesService, userId),
      signal,
      auth,
    });
  }
}
