import {
  applyRate,
  computeInvoiceTax,
  formatRate,
  isPlausibleVatId,
  normalizeTaxId,
  OUTSIDE_SCOPE_NOTICE,
  REVERSE_CHARGE_NOTICE,
  EU_DESTINATION_NOTICE,
} from './invoice-tax.calculator';

const IE_SELLER = { country: 'IE', taxId: 'IE1234567T' };
const GB_SELLER = { country: 'GB', taxId: 'GB123456789' };
const LINES = [
  { description: 'Senior Engineer placement', amount: 1_000_000n },
  { description: 'Designer placement', amount: 500_000n },
];

describe('computeInvoiceTax (#506)', () => {
  describe('domestic VAT', () => {
    it('charges the seller country standard rate when the customer is in the same country', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'IE', taxId: 'IE7654321W' },
        lines: LINES,
      });

      expect(result.treatment).toBe('DOMESTIC');
      expect(result.rateBps).toBe(2300);
      expect(result.subtotal).toBe(1_500_000n);
      expect(result.taxTotal).toBe(345_000n);
      expect(result.total).toBe(1_845_000n);
      expect(result.taxLines).toEqual([
        { label: 'VAT 23% (IE)', rateBps: 2300, base: 1_500_000n, amount: 345_000n },
      ]);
      expect(result.notices).toEqual([]);
    });

    it('applies domestic VAT for a UK seller and UK customer', () => {
      const result = computeInvoiceTax({
        seller: GB_SELLER,
        customer: { country: 'gb' },
        lines: [{ description: 'fee', amount: 1_000n }],
      });

      expect(result.treatment).toBe('DOMESTIC');
      expect(result.taxTotal).toBe(200n);
    });

    it('treats a customer with no country as domestic (conservative)', () => {
      const result = computeInvoiceTax({ seller: IE_SELLER, customer: {}, lines: LINES });

      expect(result.treatment).toBe('DOMESTIC');
      expect(result.rateBps).toBe(2300);
    });

    it('supports fractional rates and per-deployment overrides', () => {
      const fi = computeInvoiceTax({
        seller: { country: 'FI', taxId: 'FI12345678' },
        customer: { country: 'FI' },
        lines: [{ description: 'fee', amount: 1_000n }],
      });
      expect(fi.rateBps).toBe(2550);
      expect(fi.taxTotal).toBe(255n);
      expect(fi.taxLines[0].label).toBe('VAT 25.5% (FI)');

      const overridden = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'IE' },
        lines: [{ description: 'fee', amount: 1_000n }],
        rateOverrides: { IE: 1350 },
      });
      expect(overridden.taxTotal).toBe(135n);
    });
  });

  describe('EU reverse charge', () => {
    it('zero-rates cross-border B2B supplies to customers with a VAT ID and adds the Art. 196 notice', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'DE', taxId: 'de 123 456 789' },
        lines: LINES,
      });

      expect(result.treatment).toBe('REVERSE_CHARGE');
      expect(result.rateBps).toBe(0);
      expect(result.taxTotal).toBe(0n);
      expect(result.total).toBe(1_500_000n);
      expect(result.taxLines).toEqual([
        { label: 'VAT 0% (reverse charge)', rateBps: 0, base: 1_500_000n, amount: 0n },
      ]);
      expect(result.notices).toEqual([REVERSE_CHARGE_NOTICE]);
      expect(result.customer.taxId).toBe('DE123456789');
    });

    it('accepts the EL prefix for Greek VAT numbers', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'GR', taxId: 'EL123456789' },
        lines: LINES,
      });

      expect(result.treatment).toBe('REVERSE_CHARGE');
    });

    it('charges the customer country rate (OSS) when an EU customer has no VAT ID', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'FR' },
        lines: [{ description: 'fee', amount: 1_000n }],
      });

      expect(result.treatment).toBe('EU_DESTINATION');
      expect(result.rateBps).toBe(2000);
      expect(result.taxTotal).toBe(200n);
      expect(result.notices).toEqual([EU_DESTINATION_NOTICE]);
    });

    it('does not reverse-charge when the VAT ID belongs to another country', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'DE', taxId: 'FR12345678901' },
        lines: [{ description: 'fee', amount: 1_000n }],
      });

      expect(result.treatment).toBe('EU_DESTINATION');
      expect(result.taxTotal).toBe(190n);
    });
  });

  describe('international (outside scope)', () => {
    it('zero-rates supplies to customers outside the EU with an outside-scope notice', () => {
      const result = computeInvoiceTax({
        seller: IE_SELLER,
        customer: { country: 'US', taxId: '12-3456789' },
        lines: LINES,
      });

      expect(result.treatment).toBe('OUTSIDE_SCOPE');
      expect(result.taxTotal).toBe(0n);
      expect(result.total).toBe(1_500_000n);
      expect(result.notices).toEqual([OUTSIDE_SCOPE_NOTICE]);
    });

    it('treats EU customers of a UK seller as outside scope (no EU reverse charge)', () => {
      const result = computeInvoiceTax({
        seller: GB_SELLER,
        customer: { country: 'DE', taxId: 'DE123456789' },
        lines: LINES,
      });

      expect(result.treatment).toBe('OUTSIDE_SCOPE');
      expect(result.notices).not.toContain(REVERSE_CHARGE_NOTICE);
    });
  });

  describe('seller not registered', () => {
    it('adds no VAT when the platform has no VAT registration configured', () => {
      const result = computeInvoiceTax({
        seller: { country: null, taxId: null },
        customer: { country: 'DE', taxId: 'DE123456789' },
        lines: LINES,
      });

      expect(result.treatment).toBe('NOT_REGISTERED');
      expect(result.taxLines).toEqual([]);
      expect(result.total).toBe(result.subtotal);
    });
  });

  it('handles an empty invoice', () => {
    const result = computeInvoiceTax({ seller: IE_SELLER, customer: { country: 'IE' }, lines: [] });

    expect(result.subtotal).toBe(0n);
    expect(result.taxTotal).toBe(0n);
  });
});

describe('tax helpers', () => {
  it('rounds half up to the nearest minor unit', () => {
    expect(applyRate(1n, 5000)).toBe(1n); // 0.5 → 1
    expect(applyRate(3n, 2000)).toBe(1n); // 0.6 → 1
    expect(applyRate(2n, 2000)).toBe(0n); // 0.4 → 0
    expect(applyRate(-3n, 2000)).toBe(-1n); // credit notes round symmetrically
  });

  it('formats rates', () => {
    expect(formatRate(2000)).toBe('20%');
    expect(formatRate(2550)).toBe('25.5%');
    expect(formatRate(810)).toBe('8.1%');
  });

  it('normalises and validates VAT IDs', () => {
    expect(normalizeTaxId(' de-123.456 789 ')).toBe('DE123456789');
    expect(normalizeTaxId('')).toBeNull();
    expect(isPlausibleVatId('DE123456789', 'DE')).toBe(true);
    expect(isPlausibleVatId('123456789', 'DE')).toBe(false);
    expect(isPlausibleVatId('EL123456789', 'GR')).toBe(true);
    expect(isPlausibleVatId('GB123456789', 'GB')).toBe(true);
    expect(isPlausibleVatId(null, 'DE')).toBe(false);
  });
});
