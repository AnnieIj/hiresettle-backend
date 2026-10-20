import { ConfigService } from '@nestjs/config';
import { isDevEndpointsEnabled } from './dev-endpoints.config';

/**
 * Helper to build a ConfigService mock from a partial env object.
 */
function mockConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T>(key: string, defaultValue?: T): T => {
      const val = env[key];
      if (val === undefined) return defaultValue as T;
      if (val === 'true' || val === '1' || val === 'yes') return true as unknown as T;
      if (val === 'false' || val === '0' || val === 'no') return false as unknown as T;
      return val as unknown as T;
    },
  } as ConfigService;
}

describe('isDevEndpointsEnabled', () => {
  it('returns true when ENABLE_DEV_ENDPOINTS=true on testnet in development', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(true);
  });

  it('returns false when ENABLE_DEV_ENDPOINTS is not set (defaults to false)', () => {
    const config = mockConfig({
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  it('returns false when ENABLE_DEV_ENDPOINTS=false', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'false',
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  // ── Production hard guards (#442: dev endpoints can NEVER be enabled on mainnet) ──

  it('returns false on mainnet even when ENABLE_DEV_ENDPOINTS=true', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'mainnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  it('returns false in production even when ENABLE_DEV_ENDPOINTS=true', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'production',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  it('returns false when both NODE_ENV=production AND STELLAR_NETWORK=mainnet', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'production',
      STELLAR_NETWORK: 'mainnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns true for futurenet with ENABLE_DEV_ENDPOINTS=true', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'development',
      STELLAR_NETWORK: 'futurenet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(true);
  });

  it('returns false when ENABLE_DEV_ENDPOINTS=true but NODE_ENV=production and network=testnet', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'production',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(false);
  });

  it('uses default NODE_ENV=development when NODE_ENV is not set', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      STELLAR_NETWORK: 'testnet',
    });
    expect(isDevEndpointsEnabled(config)).toBe(true);
  });

  it('uses default STELLAR_NETWORK=testnet when not set', () => {
    const config = mockConfig({
      ENABLE_DEV_ENDPOINTS: 'true',
      NODE_ENV: 'development',
    });
    expect(isDevEndpointsEnabled(config)).toBe(true);
  });
});
