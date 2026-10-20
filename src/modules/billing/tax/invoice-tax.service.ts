import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  computeInvoiceTax,
  InvoiceLineInput,
  InvoiceTaxResult,
  normalizeCountry,
  normalizeTaxId,
  TaxParty,
} from './invoice-tax.calculator';

export interface InvoiceSeller extends TaxParty {
  name: string;
}

/**
 * Applies the invoice VAT rules (#506) with the platform's seller details
 * from configuration:
 *
 *   INVOICE_SELLER_NAME         Legal name printed on invoices (default "HireSettle")
 *   INVOICE_SELLER_COUNTRY      ISO country of the VAT registration, e.g. "IE"
 *   INVOICE_SELLER_TAX_ID       Seller VAT number, e.g. "IE1234567T"
 *   INVOICE_VAT_RATE_OVERRIDES  JSON map of country → basis points, e.g. {"DE":1900}
 *
 * With no seller country/VAT ID configured, invoices carry no VAT, which is the
 * same as the behaviour before #506.
 */
@Injectable()
export class InvoiceTaxService {
  constructor(private readonly config: ConfigService) {}

  seller(): InvoiceSeller {
    return {
      name: this.config.get<string>('INVOICE_SELLER_NAME') || 'HireSettle',
      country: normalizeCountry(this.config.get<string>('INVOICE_SELLER_COUNTRY')),
      taxId: normalizeTaxId(this.config.get<string>('INVOICE_SELLER_TAX_ID')),
    };
  }

  compute(customer: TaxParty, lines: InvoiceLineInput[]): InvoiceTaxResult {
    return computeInvoiceTax({
      seller: this.seller(),
      customer,
      lines,
      rateOverrides: this.rateOverrides(),
    });
  }

  private rateOverrides(): Record<string, number> {
    const raw = this.config.get<string>('INVOICE_VAT_RATE_OVERRIDES');
    if (!raw) return {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const overrides: Record<string, number> = {};
    for (const [country, bps] of Object.entries(parsed ?? {})) {
      const code = normalizeCountry(country);
      if (!code || !Number.isInteger(bps) || (bps as number) < 0 || (bps as number) > 10000) {
        throw new Error(`Invalid INVOICE_VAT_RATE_OVERRIDES entry "${country}": ${bps}`);
      }
      overrides[code] = bps as number;
    }
    return overrides;
  }
}
