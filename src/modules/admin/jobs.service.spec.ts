import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobsService, buildJobKey, parseJobKey } from './jobs.service';

function makeQueue(name: string, overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    name,
    getJobSchedulers: jest.fn(async () => []),
    getDelayed: jest.fn(async () => []),
    removeJobScheduler: jest.fn(async () => true),
    getJob: jest.fn(async () => null),
    ...overrides,
  } as any;
}

function setup() {
  const delayedJob = {
    id: 'job-7',
    name: 'send-digest',
    timestamp: Date.parse('2026-10-19T10:00:00Z'),
    delay: 60_000,
    repeatJobKey: undefined,
    remove: jest.fn(async () => undefined),
  };
  const email = makeQueue('email', {
    getJobSchedulers: jest.fn(async () => [
      { key: 'daily-digest', name: 'digest', pattern: '0 8 * * *', next: Date.parse('2026-10-20T08:00:00Z') },
    ]),
    getDelayed: jest.fn(async () => [delayedJob, { id: 'r1', name: 'digest', repeatJobKey: 'daily-digest' }]),
    getJob: jest.fn(async (id: string) => (id === 'job-7' ? delayedJob : null)),
  });
  const queues = ['stellar-tx', 'webhook', 'slack', 'discord', 'teams'].map((name) => makeQueue(name));

  const cronJob = {
    nextDate: () => ({ toJSDate: () => new Date('2026-10-20T03:00:00Z') }),
    cronTime: { source: '0 3 * * *' },
    running: true,
  };
  const scheduler = {
    getCronJobs: jest.fn(() => new Map([['data-retention', cronJob]])),
    getIntervals: jest.fn(() => ['metrics-flush']),
    getTimeouts: jest.fn(() => []),
    deleteCronJob: jest.fn(),
    deleteInterval: jest.fn(),
    deleteTimeout: jest.fn(),
  } as any;
  const prisma = { auditLog: { create: jest.fn(async () => ({})) } } as any;

  const service = new JobsService(scheduler, prisma, email, ...(queues as [any, any, any, any, any]));
  return { service, email, scheduler, prisma, delayedJob };
}

describe('JobsService (#505)', () => {
  it('lists BullMQ schedulers, delayed jobs and named in-process jobs', async () => {
    const { service } = setup();

    const jobs = await service.listScheduled();

    expect(jobs).toEqual([
      expect.objectContaining({
        jobKey: 'bullmq-scheduler:email:daily-digest',
        kind: 'bullmq-scheduler',
        queue: 'email',
        pattern: '0 8 * * *',
        nextRunAt: '2026-10-20T08:00:00.000Z',
        scope: 'cluster',
      }),
      expect.objectContaining({
        jobKey: 'bullmq-delayed:email:job-7',
        kind: 'bullmq-delayed',
        nextRunAt: '2026-10-19T10:01:00.000Z',
      }),
      expect.objectContaining({
        jobKey: 'cron:data-retention',
        kind: 'cron',
        pattern: '0 3 * * *',
        running: true,
        scope: 'instance',
      }),
      expect.objectContaining({ jobKey: 'interval:metrics-flush', kind: 'interval' }),
    ]);
  });

  it('skips delayed jobs that belong to a repeatable scheduler', async () => {
    const { service } = setup();

    const jobs = await service.listScheduled();

    expect(jobs.some((j) => j.jobKey.endsWith(':r1'))).toBe(false);
  });

  it('removes a BullMQ job scheduler and audit-logs it', async () => {
    const { service, email, prisma } = setup();

    const result = await service.removeScheduled('bullmq-scheduler:email:daily-digest', 'admin-1', 'Duplicate digest');

    expect(email.removeJobScheduler).toHaveBeenCalledWith('daily-digest');
    expect(result.removed.name).toBe('digest');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'ScheduledJob',
        entityId: 'bullmq-scheduler:email:daily-digest',
        action: 'SCHEDULED_JOB_REMOVED',
        reason: 'Duplicate digest',
        changedBy: 'admin-1',
      }),
    });
  });

  it('removes delayed jobs, cron jobs and intervals', async () => {
    const { service, delayedJob, scheduler } = setup();

    await service.removeScheduled('bullmq-delayed:email:job-7', 'admin-1', 'Stale');
    await service.removeScheduled('cron:data-retention', 'admin-1', 'Pause retention');
    await service.removeScheduled('interval:metrics-flush', 'admin-1', 'Noise');

    expect(delayedJob.remove).toHaveBeenCalled();
    expect(scheduler.deleteCronJob).toHaveBeenCalledWith('data-retention');
    expect(scheduler.deleteInterval).toHaveBeenCalledWith('metrics-flush');
  });

  it('404s for unknown jobs without writing an audit log', async () => {
    const { service, prisma } = setup();

    await expect(service.removeScheduled('cron:missing', 'admin-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects malformed job keys', async () => {
    const { service } = setup();

    await expect(service.removeScheduled('nonsense', 'admin-1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('job keys', () => {
  it('round-trips keys containing colons', () => {
    const key = buildJobKey('bullmq-scheduler', 'repeat:abc:123', 'email');
    expect(parseJobKey(key)).toEqual({ kind: 'bullmq-scheduler', queue: 'email', id: 'repeat:abc:123' });
    expect(parseJobKey('cron:a:b')).toEqual({ kind: 'cron', queue: null, id: 'a:b' });
  });

  it.each(['', 'bullmq-delayed:email', 'cron:', 'other:x'])('rejects %p', (key) => {
    expect(() => parseJobKey(key)).toThrow(BadRequestException);
  });
});
