import { Module } from '@nestjs/common';
import { AiInfrastructureModule } from '@ai';
import { NotesModule } from '../notes/notes.module';
import { AiController } from './controller/ai.controller';
import { AiService } from './service/ai.service';
import { AiAgentService } from './service/aiAgent.service';

@Module({
  imports: [AiInfrastructureModule, NotesModule],
  controllers: [AiController],
  providers: [AiService, AiAgentService],
})
export class AiModule {}
