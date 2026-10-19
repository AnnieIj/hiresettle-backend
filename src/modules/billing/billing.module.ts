import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, BillingExportController } from './billing.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ExchangeRatesModule } from '../../common/exchange-rates/exchange-rates.module';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { CreditLedgerService } from './credit-ledger.service';
import { AdminCreditLedgerController, CreditLedgerController } from './credit-ledger.controller';

@Module({
  imports: [PrismaModule, ExchangeRatesModule],
  controllers: [BillingController, BillingExportController, CreditLedgerController, AdminCreditLedgerController],
  providers: [BillingService, CreditLedgerService, CompanyRoleGuard],
  exports: [BillingService, CreditLedgerService],
})
export class BillingModule {}
