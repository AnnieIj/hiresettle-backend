/**
 * Invoice VAT computation (#506).
 *
 * Pure functions (no I/O) so the rules are easy to unit-test. Amounts are
 * integer minor units (stroops for on-chain tokens) as bigint, and rates are
 * basis points (1 bp = 0.01%), so no floating-point rounding is involved.
 *
 * HireSettle's fees are B2B services, so the place of supply is the
 * customer's country:
 *
 *   1. Seller not VAT-registered (no seller country/VAT ID)  → NOT_REGISTERED, no VAT.
 *   2. Customer in the seller's country                       → DOMESTIC, seller's standard rate.
 *   3. Seller and customer in the EU, different countries,
 *      customer has a VAT ID                                  → REVERSE_CHARGE, 0% + Art. 196 notice.
 *   4. Seller and customer in the EU, customer has no VAT ID  → EU_DESTINATION, customer's
 *      standard rate (treated as B2C, declared through OSS).
 *   5. Customer outside the seller's VAT area                 → OUTSIDE_SCOPE, 0% + notice.
 *   6. Customer country unknown                               → DOMESTIC (conservative default).
 */

export type TaxTreatment =
  | 'NOT_REGISTERED'
  | 'DOMESTIC'
  | 'REVERSE_CHARGE'
  | 'EU_DESTINATION'
  | 'OUTSIDE_SCOPE';

/** EU member states (ISO 3166-1 alpha-2). */
export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Standard VAT rates in basis points. Rates change: review periodically and
 * override per deployment with INVOICE_VAT_RATE_OVERRIDES.
 */
export const STANDARD_VAT_RATES_BPS: Readonly<Record<string, number>> = {
  AT: 2000, BE: 2100, BG: 2000, HR: 2500, CY: 1900, CZ: 2100, DK: 2500, EE: 2400,
  FI: 2550, FR: 2000, DE: 1900, GR: 2400, HU: 2700, IE: 2300, IT: 2200, LV: 2100,
  LT: 2100, LU: 1700, MT: 1800, NL: 2100, PL: 2300, PT: 2300, RO: 2100, SK: 2300,
  SI: 2200, ES: 2100, SE: 2500,
  GB: 2000, NO: 2500, CH: 810,
};

export const REVERSE_CHARGE_NOTICE =
  'Reverse charge: VAT to be accounted for by the recipient (Article 196, Council Directive 2006/112/EC).';
export const OUTSIDE_SCOPE_NOTICE =
  'Services outside the scope of VAT in the supplier\'s country (place of supply: customer\'s country).';
export const EU_DESTINATION_NOTICE =
  'VAT charged at the rate of the customer\'s EU member state (One-Stop Shop).';

export interface TaxParty {
  /** ISO 3166-1 alpha-2 country code. */
  country?: string | null;
  /** VAT / tax registration number. */
  taxId?: string | null;
}

export interface InvoiceLineInput {
  description: string;
  /** Net amount in minor units. */
  amount: bigint;
}

export interface InvoiceTaxLine {
  label: string;
  rateBps: number;
  /** Net amount the rate was applied to. */
  base: bigint;
  amount: bigint;
}

export interface InvoiceTaxResult {
  treatment: TaxTreatment;
  rateBps: number;
  subtotal: bigint;
  taxTotal: bigint;
  total: bigint;
  taxLines: InvoiceTaxLine[];
  /** Statutory wording that must be printed on the invoice. */
  notices: string[];
  seller: { country: string | null; taxId: string | null };
  customer: { country: string | null; taxId: string | null };
}

export interface ComputeInvoiceTaxInput {
  seller: TaxParty;
  customer: TaxParty;
  lines: InvoiceLineInput[];
  /** Per-country standard-rate overrides in basis points. */
  rateOverrides?: Readonly<Record<string, number>>;
}

export function normalizeCountry(country?: string | null): string | null {
  const value = (country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

/** Uppercase and strip spaces, dots and dashes: "de 123.456-789" → "DE123456789". */
export function normalizeTaxId(taxId?: string | null): string | null {
  const value = (taxId ?? '').replace(/[\s.\-]/g, '').toUpperCase();
  return value.length > 0 ? value : null;
}

/** VAT number prefix for a country (Greece uses "EL"). */
export function vatPrefix(country: string): string {
  return country === 'GR' ? 'EL' : country;
}

/**
 * Structural check only (prefix + 2–13 alphanumerics). It does not prove the
 * number is registered — verify against VIES before relying on it.
 */
export function isPlausibleVatId(taxId: string | null, country: string | null): boolean {
  if (!taxId || !country) return false;
  if (!EU_COUNTRIES.has(country)) return /^[A-Z0-9]{4,20}$/.test(taxId);
  const prefix = vatPrefix(country);
  return taxId.startsWith(prefix) && /^[A-Z0-9]{2,13}$/.test(taxId.slice(prefix.length));
}

export function standardRateBps(
  country: string,
  overrides: Readonly<Record<string, number>> = {},
): number {
  const rate = overrides[country] ?? STANDARD_VAT_RATES_BPS[country];
  if (rate === undefined) {
    throw new Error(`No standard VAT rate configured for country "${country}"`);
  }
  return rate;
}

/** Round half up to the nearest minor unit. */
export function applyRate(base: bigint, rateBps: number): bigint {
  if (rateBps === 0 || base === 0n) return 0n;
  const numerator = base * BigInt(rateBps);
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator * sign;
  return sign * ((abs + 5000n) / 10000n);
}

export function formatRate(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toString()}%`;
}

export function computeInvoiceTax(input: ComputeInvoiceTaxInput): InvoiceTaxResult {
  const overrides = input.rateOverrides ?? {};
  const sellerCountry = normalizeCountry(input.seller.country);
  const sellerTaxId = normalizeTaxId(input.seller.taxId);
  const customerCountry = normalizeCountry(input.customer.country);
  const customerTaxId = normalizeTaxId(input.customer.taxId);
  const subtotal = input.lines.reduce((sum, line) => sum + line.amount, 0n);

  const result = (
    treatment: TaxTreatment,
    rateBps: number,
    label: string | null,
    notices: string[] = [],
  ): InvoiceTaxResult => {
    const taxTotal = applyRate(subtotal, rateBps);
    return {
      treatment,
      rateBps,
      subtotal,
      taxTotal,
      total: subtotal + taxTotal,
      taxLines: label ? [{ label, rateBps, base: subtotal, amount: taxTotal }] : [],
      notices,
      seller: { country: sellerCountry, taxId: sellerTaxId },
      customer: { country: customerCountry, taxId: customerTaxId },
    };
  };

  if (!sellerCountry || !sellerTaxId) {
    return result('NOT_REGISTERED', 0, null);
  }

  if (!customerCountry || customerCountry === sellerCountry) {
    const rate = standardRateBps(sellerCountry, overrides);
    return result('DOMESTIC', rate, `VAT ${formatRate(rate)} (${sellerCountry})`);
  }

  const bothEu = EU_COUNTRIES.has(sellerCountry) && EU_COUNTRIES.has(customerCountry);
  if (bothEu) {
    if (isPlausibleVatId(customerTaxId, customerCountry)) {
      return result('REVERSE_CHARGE', 0, 'VAT 0% (reverse charge)', [REVERSE_CHARGE_NOTICE]);
    }
    const rate = standardRateBps(customerCountry, overrides);
    return result('EU_DESTINATION', rate, `VAT ${formatRate(rate)} (${customerCountry})`, [
      EU_DESTINATION_NOTICE,
    ]);
  }

  return result('OUTSIDE_SCOPE', 0, 'VAT 0% (outside scope)', [OUTSIDE_SCOPE_NOTICE]);
}
