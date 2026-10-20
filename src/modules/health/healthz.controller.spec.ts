import { ServiceUnavailableException } from '@nestjs/common';
import { HealthzController } from './healthz.controller';

describe('HealthzController (#510)', () => {
  const healthService = { isDatabaseHealthy: jest.fn() };
  const queueHealth = { isHealthy: jest.fn() };
  const controller = new HealthzController(healthService as any, queueHealth as any);

  beforeEach(() => jest.clearAllMocks());

  it('live() reports ok without touching dependencies', () => {
    expect(controller.live()).toMatchObject({ status: 'ok' });
    expect(healthService.isDatabaseHealthy).not.toHaveBeenCalled();
    expect(queueHealth.isHealthy).not.toHaveBeenCalled();
  });

  it('ready() reports ok when Postgres and Redis are up', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'up' } });
    queueHealth.isHealthy.mockResolvedValue({ queues: { status: 'up' } });

    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      checks: { database: { status: 'up' }, queues: { status: 'up' } },
    });
  });

  it('ready() throws 503 when a dependency is down', async () => {
    healthService.isDatabaseHealthy.mockResolvedValue({ database: { status: 'down', message: 'refused' } });
    queueHealth.isHealthy.mockResolvedValue({ queues: { status: 'up' } });

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
