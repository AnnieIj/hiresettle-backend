import { InvoiceTaxResult, formatRate } from './invoice-tax.calculator';

export interface InvoicePdfInput {
  invoiceNumber: string;
  issuedAt: Date;
  periodFrom: Date;
  periodTo: Date;
  seller: { name: string; country: string | null; taxId: string | null };
  customer: { name: string; email: string | null; country: string | null; taxId: string | null };
  lines: { description: string; amount: bigint }[];
  tax: InvoiceTaxResult;
  /** Unit label for amounts, e.g. "stroops". */
  unit: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 72;
const AMOUNT_RIGHT = PAGE_WIDTH - 72;
const BOTTOM = 72;

/** Escape text for a PDF literal string and drop non-Latin-1 characters. */
export function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Helvetica average glyph width is ~0.5em: good enough to right-align numbers. */
function approxWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

/**
 * Text drawing commands for the invoice (#506), split into pages.
 * Kept separate from PDF serialisation so tests can assert on the content.
 */
export function buildInvoiceContent(input: InvoicePdfInput): string[][] {
  const pages: string[][] = [[]];
  let y = PAGE_HEIGHT - 72;

  const text = (value: string, size: number, x = LEFT) =>
    pages[pages.length - 1].push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj ET`);
  const right = (value: string, size: number) =>
    text(value, size, Math.round(AMOUNT_RIGHT - approxWidth(value, size)));
  const advance = (dy: number) => {
    y -= dy;
    if (y < BOTTOM) {
      pages.push([]);
      y = PAGE_HEIGHT - 72;
    }
  };
  const row = (label: string, amount: string, size = 10) => {
    text(label, size);
    right(amount, size);
    advance(size + 6);
  };

  text(`${input.seller.name} Invoice`, 18);
  advance(26);
  text(`Invoice #: ${input.invoiceNumber}`, 11);
  advance(15);
  text(`Issued: ${formatDate(input.issuedAt)}`, 11);
  advance(15);
  text(`Period: ${formatDate(input.periodFrom)} to ${formatDate(input.periodTo)}`, 11);
  advance(24);

  text('From', 11);
  advance(15);
  text(input.seller.name, 10);
  advance(14);
  if (input.seller.country) {
    text(`Country: ${input.seller.country}`, 10);
    advance(14);
  }
  if (input.seller.taxId) {
    text(`VAT ID: ${input.seller.taxId}`, 10);
    advance(14);
  }
  advance(8);

  text('Bill to', 11);
  advance(15);
  text(input.customer.name, 10);
  advance(14);
  text(`Contact: ${input.customer.email ?? 'N/A'}`, 10);
  advance(14);
  if (input.customer.country) {
    text(`Country: ${input.customer.country}`, 10);
    advance(14);
  }
  if (input.customer.taxId) {
    text(`VAT ID: ${input.customer.taxId}`, 10);
    advance(14);
  }
  advance(10);

  row('Description', `Amount (${input.unit})`, 11);
  if (input.lines.length === 0) {
    row('No billable engagements in this period', '0');
  }
  for (const line of input.lines) {
    row(line.description, line.amount.toString());
  }
  advance(6);

  row('Subtotal (net)', input.tax.subtotal.toString(), 11);
  for (const taxLine of input.tax.taxLines) {
    row(`${taxLine.label} on ${taxLine.base.toString()}`, taxLine.amount.toString(), 11);
  }
  if (input.tax.taxLines.length === 0) {
    row('VAT', 'not applicable', 11);
  }
  row(`Total due (${formatRate(input.tax.rateBps)} VAT)`, input.tax.total.toString(), 12);
  advance(10);

  for (const notice of input.tax.notices) {
    text(notice, 8);
    advance(12);
  }

  return pages;
}

/** Serialise pages of content streams into a minimal, valid PDF 1.4 file. */
export function renderPdf(pages: string[][]): Buffer {
  // Object layout: 1 catalog, 2 pages tree, 3 font, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((commands, i) => {
    const pageId = pageIds[i];
    const stream = commands.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Contents ${pageId + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

export function renderInvoicePdf(input: InvoicePdfInput): Buffer {
  return renderPdf(buildInvoiceContent(input));
}
