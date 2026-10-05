import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthUser } from '@security';
import { CurrentUser } from '@common/decorators';
import { AgentEvent } from '@ai';
import { AiService } from '../service/ai.service';
import { AiAgentService } from '../service/aiAgent.service';
import { CompleteDto, CompleteResponseDto } from '../dto/complete.dto';
import { AgentRunDto } from '../dto/agentRun.dto';
import { AI_THROTTLE } from '../consts/ai.consts';

@Throttle(AI_THROTTLE)
@Controller('/ai')
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(
    private readonly aiService: AiService,
    private readonly aiAgentService: AiAgentService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('complete')
  async complete(
    @Body() dto: CompleteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CompleteResponseDto> {
    return await this.aiService.complete(dto.prompt, user.sub);
  }

  /** Streams agent progress as Server-Sent Events (text/event-stream). */
  @Post('agent')
  async runAgent(
    @Body() dto: AgentRunDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const send = (event: AgentEvent) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of this.aiAgentService.run(dto.task, user.sub, abort.signal)) {
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
