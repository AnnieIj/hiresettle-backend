import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, BillingExportController } from './billing.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ExchangeRatesModule } from '../../common/exchange-rates/exchange-rates.module';
import { CompanyRoleGuard } from '../../common/guards/company-role.guard';
import { InvoiceTaxService } from './tax/invoice-tax.service';

@Module({
  imports: [PrismaModule, ExchangeRatesModule],
  controllers: [BillingController, BillingExportController],
  providers: [BillingService, InvoiceTaxService, CompanyRoleGuard],
  exports: [BillingService, InvoiceTaxService],
})
export class BillingModule {}
