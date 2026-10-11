import { Module } from '@nestjs/common';
import { AiInfrastructureModule } from '@ai';
import { NotesModule } from '../notes/notes.module';
import { AiController } from './controller/ai.controller';
import { AiSettingsController } from './controller/aiSettings.controller';
import { AiService } from './service/ai.service';
import { AiAgentService } from './service/aiAgent.service';
import { AiChatService } from './service/aiChat.service';
import { AiCredentialsService } from './credentials/aiCredentials.service';
import { AiRunLimiter } from './credentials/aiRunLimiter.service';
import { RagRepository } from './rag/rag.repository';
import { RagSearchService } from './rag/ragSearch.service';
import { RagIndexerService } from './rag/ragIndexer.service';
import { AI_MODULE_CONFIG, aiModuleConfig } from './config/aiModule.config';

@Module({
  imports: [AiInfrastructureModule, NotesModule],
  controllers: [AiController, AiSettingsController],
  providers: [
    { provide: AI_MODULE_CONFIG, useFactory: aiModuleConfig },
    AiService,
    AiAgentService,
    AiChatService,
    AiCredentialsService,
    AiRunLimiter,
    RagRepository,
    RagSearchService,
    RagIndexerService,
  ],
})
export class AiModule {}
