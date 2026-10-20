import { Module } from '@nestjs/common';
import { StellarController } from './stellar.controller';
import { StellarModule as CommonStellarModule } from '../../common/stellar/stellar.module';
import { AppCacheModule } from '../../common/cache/cache.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StellarTxStatusService } from './stellar-tx-status.service';
import { FeeSponsorshipService } from './fee-sponsorship.service';
import { AuthModule } from '../auth/auth.module';
import { Sep10Service } from './sep10.service';
import { Sep10Controller } from './sep10.controller';

@Module({
  imports: [CommonStellarModule, AppCacheModule, PrismaModule, AuthModule],
  controllers: [StellarController, Sep10Controller],
  providers: [StellarTxStatusService, FeeSponsorshipService, Sep10Service],
  exports: [StellarTxStatusService, FeeSponsorshipService, Sep10Service],
})
export class StellarModule {}
