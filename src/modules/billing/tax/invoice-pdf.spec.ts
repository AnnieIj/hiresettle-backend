import { computeInvoiceTax, OUTSIDE_SCOPE_NOTICE, REVERSE_CHARGE_NOTICE } from './invoice-tax.calculator';
import { buildInvoiceContent, escapePdfText, InvoicePdfInput, renderInvoicePdf } from './invoice-pdf';

const SELLER = { name: 'HireSettle Ltd', country: 'IE', taxId: 'IE1234567T' };
const LINES = [{ description: 'Senior Engineer (eng-1)', amount: 1_000_000n }];

function makeInput(customer: { country: string | null; taxId: string | null }): InvoicePdfInput {
  const tax = computeInvoiceTax({ seller: SELLER, customer, lines: LINES });
  return {
    invoiceNumber: 'INV-0001001',
    issuedAt: new Date('2026-10-19T00:00:00Z'),
    periodFrom: new Date('2026-10-01T00:00:00Z'),
    periodTo: new Date('2026-10-31T00:00:00Z'),
    seller: SELLER,
    customer: { name: 'Acme (Pty)', email: 'billing@acme.test', ...customer },
    lines: LINES,
    tax,
    unit: 'stroops',
  };
}

function text(input: InvoicePdfInput): string {
  return buildInvoiceContent(input).flat().join('\n');
}

describe('invoice PDF tax rendering (#506)', () => {
  it('prints the domestic VAT line, subtotal and gross total', () => {
    const content = text(makeInput({ country: 'IE', taxId: null }));

    expect(content).toContain('(Subtotal \\(net\\))');
    expect(content).toContain('(1000000)');
    expect(content).toContain('(VAT 23% \\(IE\\) on 1000000)');
    expect(content).toContain('(230000)');
    expect(content).toContain('(1230000)');
    expect(content).not.toContain('Reverse charge');
  });

  it('prints both VAT IDs and the reverse charge notice for EU B2B customers', () => {
    const content = text(makeInput({ country: 'DE', taxId: 'DE123456789' }));

    expect(content).toContain('(VAT ID: IE1234567T)');
    expect(content).toContain('(VAT ID: DE123456789)');
    expect(content).toContain('(VAT 0% \\(reverse charge\\) on 1000000)');
    expect(content).toContain(escapePdfText(REVERSE_CHARGE_NOTICE));
  });

  it('prints the outside-scope notice for international customers', () => {
    const content = text(makeInput({ country: 'US', taxId: null }));

    expect(content).toContain(escapePdfText(OUTSIDE_SCOPE_NOTICE));
  });

  it('escapes PDF string delimiters and strips unsupported characters', () => {
    expect(escapePdfText('a (b) \\ c')).toBe('a \\(b\\) \\\\ c');
    expect(escapePdfText('Zürich ✓')).toBe('Zürich ?');
  });

  it('paginates long invoices', () => {
    const input = makeInput({ country: 'IE', taxId: null });
    input.lines = Array.from({ length: 80 }, (_, i) => ({ description: `Line ${i}`, amount: 1n }));

    expect(buildInvoiceContent(input).length).toBeGreaterThan(1);
  });

  it('produces a structurally valid PDF with a correct xref table', () => {
    const pdf = renderInvoicePdf(makeInput({ country: 'DE', taxId: 'DE123456789' })).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    // Every xref entry must point at the start of its "N 0 obj" header.
    const entries = pdf.slice(startxref).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});
