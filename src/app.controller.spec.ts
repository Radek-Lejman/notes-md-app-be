import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const getHello = jest.fn<string, []>();

  beforeEach(async () => {
    getHello.mockReset().mockReturnValue('hello from service');

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getHello } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('root returns the greeting of AppService', () => {
    expect(appController.getHello()).toBe('hello from service');
    expect(getHello).toHaveBeenCalledTimes(1);
  });

  it('health answers ok without touching the service', () => {
    expect(appController.health()).toEqual({ status: 'ok' });
    expect(getHello).not.toHaveBeenCalled();
  });
});
