import { MODULE_METADATA } from '@nestjs/common/constants';
import { AiInfrastructureModule } from '@ai';
import { AiModule } from './ai.module';
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
import { AI_MODULE_CONFIG } from './config/aiModule.config';
import { NotesModule } from '../notes/notes.module';

describe('AiModule', () => {
  it('wires infrastructure, notes, controllers and services', () => {
    const meta = (key: string) => Reflect.getMetadata(key, AiModule) as unknown;

    expect(meta(MODULE_METADATA.IMPORTS)).toEqual([AiInfrastructureModule, NotesModule]);
    expect(meta(MODULE_METADATA.CONTROLLERS)).toEqual([AiController, AiSettingsController]);
    expect(meta(MODULE_METADATA.PROVIDERS)).toEqual([
      expect.objectContaining({ provide: AI_MODULE_CONFIG }),
      AiService,
      AiAgentService,
      AiChatService,
      AiCredentialsService,
      AiRunLimiter,
      RagRepository,
      RagSearchService,
      RagIndexerService,
    ]);
  });
});
