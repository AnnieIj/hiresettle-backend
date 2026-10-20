import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemConfigService } from './system-config.service';

/** Global so any service can read runtime settings without extra imports (#503). */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}
