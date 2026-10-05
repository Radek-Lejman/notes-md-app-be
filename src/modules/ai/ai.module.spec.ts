import { MODULE_METADATA } from '@nestjs/common/constants';
import { AiInfrastructureModule } from '@ai';
import { AiModule } from './ai.module';
import { AiController } from './controller/ai.controller';
import { AiService } from './service/ai.service';
import { AiAgentService } from './service/aiAgent.service';
import { NotesModule } from '../notes/notes.module';

describe('AiModule', () => {
  it('wires infrastructure, notes, controller and services', () => {
    const meta = (key: string) => Reflect.getMetadata(key, AiModule) as unknown;

    expect(meta(MODULE_METADATA.IMPORTS)).toEqual([AiInfrastructureModule, NotesModule]);
    expect(meta(MODULE_METADATA.CONTROLLERS)).toEqual([AiController]);
    expect(meta(MODULE_METADATA.PROVIDERS)).toEqual([AiService, AiAgentService]);
  });
});
