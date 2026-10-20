import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EngagementStatus } from '@prisma/client';
import { BillingService } from '../billing.service';
import { REVERSE_CHARGE_NOTICE } from './invoice-tax.calculator';
import { escapePdfText } from './invoice-pdf';
import { InvoiceTaxService } from './invoice-tax.service';

function makeTaxService(values: Record<string, unknown>) {
  return new InvoiceTaxService({ get: (key: string) => values[key] } as any);
}

const SELLER_CONFIG = {
  INVOICE_SELLER_NAME: 'HireSettle Ltd',
  INVOICE_SELLER_COUNTRY: 'IE',
  INVOICE_SELLER_TAX_ID: 'IE1234567T',
};

describe('InvoiceTaxService (#506)', () => {
  it('reads the seller registration from config', () => {
    expect(makeTaxService(SELLER_CONFIG).seller()).toEqual({
      name: 'HireSettle Ltd',
      country: 'IE',
      taxId: 'IE1234567T',
    });
  });

  it('adds no VAT when the seller is not configured (pre-#506 behaviour)', () => {
    const result = makeTaxService({}).compute({ country: 'IE' }, [{ description: 'x', amount: 100n }]);

    expect(result.treatment).toBe('NOT_REGISTERED');
    expect(result.total).toBe(100n);
  });

  it('applies INVOICE_VAT_RATE_OVERRIDES', () => {
    const service = makeTaxService({ ...SELLER_CONFIG, INVOICE_VAT_RATE_OVERRIDES: '{"ie":1350}' });

    expect(service.compute({ country: 'IE' }, [{ description: 'x', amount: 1000n }]).taxTotal).toBe(135n);
  });

  it('rejects invalid rate overrides', () => {
    const service = makeTaxService({ ...SELLER_CONFIG, INVOICE_VAT_RATE_OVERRIDES: '{"IE":0.23}' });

    expect(() => service.compute({ country: 'IE' }, [])).toThrow(/Invalid INVOICE_VAT_RATE_OVERRIDES/);
  });
});

describe('BillingService invoices with tax (#506)', () => {
  const company = {
    id: 'company-1',
    stellarAddress: 'GCOMPANY',
    email: 'billing@acme.test',
    name: 'Jane',
    company: 'Acme GmbH',
    taxCountry: 'DE',
    taxId: 'DE123456789',
  };
  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    engagement: {
      findMany: jest.fn(async () => [
        {
          id: 'eng-1',
          jobTitle: 'Senior Engineer',
          companyAddress: 'GCOMPANY',
          tokenAddress: 'CUSDC',
          totalAmount: 1_000_000n,
          releasedAmount: 0n,
          status: EngagementStatus.ACTIVE,
          createdAt: new Date('2026-10-05T00:00:00Z'),
        },
      ]),
    },
  };
  const service = new BillingService(
    prisma as any,
    {} as any,
    {} as any,
    makeTaxService(SELLER_CONFIG),
  );

  beforeEach(() => jest.clearAllMocks());

  it('renders the reverse charge on a German B2B customer invoice', async () => {
    prisma.user.findUnique.mockResolvedValue(company);

    const pdf = (await service.generateInvoicePdf({ id: 'company-1' }, 'inv-1')).toString('latin1');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'company-1' } });
    expect(pdf).toContain('(VAT ID: DE123456789)');
    expect(pdf).toContain('(VAT 0% \\(reverse charge\\) on 1000000)');
    expect(pdf).toContain(escapePdfText(REVERSE_CHARGE_NOTICE));
  });

  it('charges domestic VAT for a customer in the seller country', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...company, taxCountry: 'IE', taxId: null });

    const pdf = (await service.generateInvoicePdf({ id: 'company-1' }, 'inv-2')).toString('latin1');

    expect(pdf).toContain('(VAT 23% \\(IE\\) on 1000000)');
    expect(pdf).toContain('(1230000)');
  });

  it('throws when the company does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.generateInvoicePdf({ id: 'missing' }, 'inv-3')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('updateTaxProfile', () => {
    it('normalises and stores the country and VAT ID', async () => {
      prisma.user.update.mockResolvedValue({ taxCountry: 'DE', taxId: 'DE123456789' });

      await service.updateTaxProfile('company-1', { taxCountry: 'de', taxId: 'de 123 456 789' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { taxCountry: 'DE', taxId: 'DE123456789' },
        select: { taxCountry: true, taxId: true },
      });
    });

    it('rejects EU VAT IDs without the country prefix', async () => {
      await expect(
        service.updateTaxProfile('company-1', { taxCountry: 'DE', taxId: '123456789' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows clearing the VAT ID', async () => {
      prisma.user.update.mockResolvedValue({ taxCountry: 'US', taxId: null });

      await service.updateTaxProfile('company-1', { taxCountry: 'US', taxId: null });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ taxCountry: 'US', taxId: null });
    });
  });
});
