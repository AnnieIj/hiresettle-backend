import { ConfigService } from '@nestjs/config';

/**
 * Determines whether the /dev/* endpoints (Friendbot, etc.) should be loaded.
 *
 * Dev endpoints are enabled only when ALL of the following are true:
 *   1. ENABLE_DEV_ENDPOINTS is truthy (env-validated, defaults to false)
 *   2. NODE_ENV is not 'production'
 *   3. STELLAR_NETWORK is not 'mainnet'
 *
 * The production / mainnet checks are hard guards — even if an operator
 * accidentally sets ENABLE_DEV_ENDPOINTS=true in production, the endpoints
 * will still be disabled.  This makes it impossible to misconfigure.
 *
 * Exported as a pure function so it can be unit-tested without a Nest
 * DI container.
 */
export function isDevEndpointsEnabled(config: ConfigService): boolean {
  const enabled = config.get<boolean>('ENABLE_DEV_ENDPOINTS', false);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const network = config.get<string>('STELLAR_NETWORK', 'testnet');

  if (!enabled) return false;
  if (nodeEnv === 'production') return false;
  if (network === 'mainnet') return false;

  return true;
}
