import { WebhooksService } from './webhooks.service';

describe('WebhooksService.getSourceIps (#491)', () => {
  const originalEnv = process.env.WEBHOOK_SOURCE_IPS;

  afterEach(() => {
    process.env.WEBHOOK_SOURCE_IPS = originalEnv;
  });

  it('returns an empty list when nothing is configured', () => {
    delete process.env.WEBHOOK_SOURCE_IPS;
    const service = new WebhooksService();
    expect(service.getSourceIps()).toEqual({ sourceIps: [] });
  });

  it('parses a comma-separated list of IPs, trimming whitespace', () => {
    process.env.WEBHOOK_SOURCE_IPS = ' 203.0.113.10 , 203.0.113.11/32,198.51.100.0/24 ';
    const service = new WebhooksService();
    expect(service.getSourceIps()).toEqual({
      sourceIps: ['203.0.113.10', '203.0.113.11/32', '198.51.100.0/24'],
    });
  });

  it('prefers a value from ConfigService over process.env', () => {
    process.env.WEBHOOK_SOURCE_IPS = '203.0.113.10';
    const config = { get: jest.fn().mockReturnValue('203.0.113.99') } as any;
    const service = new WebhooksService(undefined, config);
    expect(service.getSourceIps()).toEqual({ sourceIps: ['203.0.113.99'] });
  });
});
