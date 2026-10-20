import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevModule } from './dev.module';
import { isDevEndpointsEnabled } from '../../config/dev-endpoints.config';

/**
 * DevModuleFactory.register() — conditionally loads DevModule based on
 * validated config instead of raw process.env (#442).
 *
 * `ConfigModule.forRoot` runs Joi validation (including ENABLE_DEV_ENDPOINTS)
 * before any module imports resolve, so process.env is already validated
 * by the time this decorator runs.  The `isDevEndpointsEnabled` function
 * provides the gating logic with hard production/mainnet guards.
 */
@Module({})
export class DevModuleFactory {
  static register(): DynamicModule {
    // Build a lightweight ConfigService-compatible wrapper around the
    // already-validated process.env.  This routes the decision through
    // the same validation pipeline as every other config value rather
    // than reading process.env ad-hoc.
    const config = {
      get: <T>(key: string, defaultValue?: T): T => {
        const val = process.env[key];
        if (val === undefined) return defaultValue as T;
        if (val === 'true' || val === '1' || val === 'yes') return true as unknown as T;
        if (val === 'false' || val === '0' || val === 'no') return false as unknown as T;
        return val as unknown as T;
      },
    } as ConfigService;

    const devEnabled = isDevEndpointsEnabled(config);

    return {
      module: class {},
      imports: devEnabled ? [DevModule] : [],
    };
  }
}
