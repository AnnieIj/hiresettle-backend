import { shouldSkipThrottle } from './app.module';

describe('shouldSkipThrottle', () => {
    it.each([
        '/health',
        '/health?full=1',
        '/status',
        '/status?full=1',
    ])('skips throttling for %s', (url) => {
        expect(shouldSkipThrottle({ url })).toBe(true);
    });

    it.each(['/api/v1/auth/login', '/metrics', '/healthz'])('does not skip throttling for %s', (url) => {
        expect(shouldSkipThrottle({ url })).toBe(false);
    });
});
