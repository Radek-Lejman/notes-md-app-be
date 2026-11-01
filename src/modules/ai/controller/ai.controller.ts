import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthUser } from '@common';
import { CurrentUser } from '@common/decorators';
import { AiService } from '../service/ai.service';
import { AiAgentService } from '../service/aiAgent.service';
import { AiChatService } from '../service/aiChat.service';
import { AiCredentialsService } from '../credentials/aiCredentials.service';
import { AiRunLimiter } from '../credentials/aiRunLimiter.service';
import { CompleteDto, CompleteResponseDto } from '../dto/complete.dto';
import { AgentRunDto } from '../dto/agentRun.dto';
import { AssistDto, AssistResponseDto } from '../dto/assist.dto';
import { ChatDto } from '../dto/chat.dto';
import { ChatEvent } from '../types/chat.types';
import { AI_CHAT_THROTTLE, AI_THROTTLE } from '../consts/ai.consts';

/**
 * Every run: rate limit (throttle) -> user's own AI account (403 if none)
 * -> concurrency slot (429 if busy) -> provider.
 */
@Throttle(AI_THROTTLE)
@Controller('/ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiAgentService: AiAgentService,
    private readonly aiChatService: AiChatService,
    private readonly credentials: AiCredentialsService,
    private readonly limiter: AiRunLimiter,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('complete')
  async complete(
    @Body() dto: CompleteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CompleteResponseDto> {
    const auth = await this.credentials.authForLlm(user.sub);
    return this.limiter.run(user.sub, () => this.aiService.complete(dto.prompt, user.sub, auth));
  }

  /** Ask AI in the editor: explain / summarize / rewrite... the selected text. */
  @HttpCode(HttpStatus.OK)
  @Post('assist')
  async assist(@Body() dto: AssistDto, @CurrentUser() user: AuthUser): Promise<AssistResponseDto> {
    const auth = await this.credentials.authForLlm(user.sub);
    return this.limiter.run(user.sub, () => this.aiService.assist(dto, user.sub, auth));
  }

  /** Streams agent progress as Server-Sent Events (text/event-stream). */
  @Post('agent')
  async runAgent(
    @Body() dto: AgentRunDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const auth = await this.credentials.authForAgent(user.sub);
    await this.limiter.run(user.sub, async () => {
      const signal = this.abortOnClose(res);
      await this.streamSse(res, this.aiAgentService.run(dto.task, user.sub, signal, auth));
    });
  }

  /** Chat turn streamed as SSE. Errors before the stream (403/404/429) are plain JSON. */
  @Throttle(AI_CHAT_THROTTLE)
  @Post('chat')
  async chat(
    @Body() dto: ChatDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const auth = await this.credentials.authForAgent(user.sub);
    await this.limiter.run(user.sub, async () => {
      const signal = this.abortOnClose(res);
      const events = await this.aiChatService.chat(dto, user.sub, auth, signal);
      await this.streamSse(res, events);
    });
  }

  /** Aborts the run when the client disconnects. */
  private abortOnClose(res: Response): AbortSignal {
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    return abort.signal;
  }

  private async streamSse(res: Response, events: AsyncIterable<ChatEvent>): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: ChatEvent) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of events) {
        send(event);
      }
    } catch (e) {
      this.logger.error(`Agent stream failed: ${(e as Error).message}`);
      send({ type: 'error', message: 'Agent failed' });
    } finally {
      res.end();
    }
  }
}
