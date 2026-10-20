import { BadRequestException } from '@nestjs/common';
import { CreditLedger, CreditLedgerEntryType, Prisma } from '@prisma/client';
import { BillingService } from './billing.service';
import { CreditLedgerService } from './credit-ledger.service';

/**
 * In-memory stand-in for the credit_ledger table that enforces the same
 * unique indexes as Postgres and yields between reads and writes, so
 * concurrent appends genuinely interleave.
 */
function createFakePrisma() {
  const rows: CreditLedger[] = [];
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const creditLedger = {
    findUnique: jest.fn(async ({ where }: any) => {
      await tick();
      const { companyId, idempotencyKey } = where.companyId_idempotencyKey;
      return rows.find((r) => r.companyId === companyId && r.idempotencyKey === idempotencyKey) ?? null;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      await tick();
      return (
        rows
          .filter((r) => r.companyId === where.companyId)
          .sort((a, b) => b.sequence - a.sequence)[0] ?? null
      );
    }),
    findMany: jest.fn(async ({ where, skip = 0, take = 50 }: any) =>
      rows
        .filter((r) => r.companyId === where.companyId && (!where.type || r.type === where.type))
        .sort((a, b) => b.sequence - a.sequence)
        .slice(skip, skip + take),
    ),
    count: jest.fn(async ({ where }: any) =>
      rows.filter((r) => r.companyId === where.companyId && (!where.type || r.type === where.type)).length,
    ),
    create: jest.fn(async ({ data }: any) => {
      await tick();
      const clash = rows.some(
        (r) =>
          r.companyId === data.companyId &&
          (r.sequence === data.sequence ||
            (data.idempotencyKey != null && r.idempotencyKey === data.idempotencyKey)),
      );
      if (clash) throw uniqueViolation();
      if (data.balanceAfter < 0n) throw new Error('credit_ledger_balance_nonnegative');
      const row = { id: `entry-${rows.length + 1}`, createdAt: new Date(), ...data } as CreditLedger;
      rows.push(row);
      return row;
    }),
  };

  const prisma: any = {
    creditLedger,
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma, rows };
}

const COMPANY = 'company-1';

describe('CreditLedgerService (#507)', () => {
  let rows: CreditLedger[];
  let service: CreditLedgerService;

  beforeEach(() => {
    const fake = createFakePrisma();
    rows = fake.rows;
    service = new CreditLedgerService(fake.prisma);
  });

  const purchase = (amount: bigint, idempotencyKey?: string) =>
    service.append(COMPANY, {
      type: CreditLedgerEntryType.PURCHASE,
      amount,
      description: 'Top-up',
      idempotencyKey,
    });

  it('starts with a zero balance', async () => {
    await expect(service.getBalance(COMPANY)).resolves.toBe(0n);
  });

  it('appends entries with gap-free sequences and running balance snapshots', async () => {
    await purchase(1_000n);
    await purchase(500n);
    await service.append(COMPANY, { type: CreditLedgerEntryType.ADJUSTMENT, amount: -200n });

    expect(rows.map((r) => [r.sequence, r.amount, r.balanceAfter])).toEqual([
      [1, 1_000n, 1_000n],
      [2, 500n, 1_500n],
      [3, -200n, 1_300n],
    ]);
    await expect(service.getBalance(COMPANY)).resolves.toBe(1_300n);
  });

  it('rejects zero amounts and entries that would make the balance negative', async () => {
    await purchase(100n);

    expect(() => service.append(COMPANY, { type: CreditLedgerEntryType.ADJUSTMENT, amount: 0n })).toThrow(
      BadRequestException,
    );
    await expect(
      service.append(COMPANY, { type: CreditLedgerEntryType.ADJUSTMENT, amount: -101n }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(1);
  });

  it('never applies the same idempotency key twice', async () => {
    const first = await purchase(1_000n, 'topup-42');
    const second = await purchase(1_000n, 'topup-42');

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    await expect(service.getBalance(COMPANY)).resolves.toBe(1_000n);
  });

  it('only ever inserts rows (append-only)', async () => {
    await purchase(1_000n);
    await service.applyToFee(COMPANY, 300n, 'fee-1');

    const prisma = (service as any).prisma;
    expect(prisma.creditLedger.update).toBeUndefined();
    expect(prisma.creditLedger.delete).toBeUndefined();
    expect(rows.map((r) => r.type)).toEqual([
      CreditLedgerEntryType.PURCHASE,
      CreditLedgerEntryType.FEE_DEDUCTION,
    ]);
  });

  it('paginates history newest first and filters by type', async () => {
    await purchase(100n);
    await purchase(200n);
    await service.applyToFee(COMPANY, 50n, 'fee-1');

    const page = await service.listEntries(COMPANY, 1, 2);
    expect(page.total).toBe(3);
    expect(page.data.map((e) => e.sequence)).toEqual([3, 2]);
    expect(page.data[0]).toMatchObject({ amount: '-50', balanceAfter: '250' });

    const fees = await service.listEntries(COMPANY, 1, 50, CreditLedgerEntryType.FEE_DEDUCTION);
    expect(fees.total).toBe(1);
  });

  describe('applyToFee', () => {
    it('covers the whole fee when the balance is sufficient', async () => {
      await purchase(1_000n);

      const result = await service.applyToFee(COMPANY, 400n, 'fee-1');

      expect(result).toMatchObject({ creditApplied: 400n, amountDue: 0n, balanceAfter: 600n });
      expect(result.entry).toMatchObject({
        type: CreditLedgerEntryType.FEE_DEDUCTION,
        amount: -400n,
        reference: 'fee-1',
      });
    });

    it('applies the remaining balance and leaves the rest for the payment processor', async () => {
      await purchase(250n);

      const result = await service.applyToFee(COMPANY, 400n, 'fee-1');

      expect(result).toMatchObject({ creditApplied: 250n, amountDue: 150n, balanceAfter: 0n });
    });

    it('writes nothing when there is no credit', async () => {
      const result = await service.applyToFee(COMPANY, 400n, 'fee-1');

      expect(result).toMatchObject({ creditApplied: 0n, amountDue: 400n, entry: null });
      expect(rows).toHaveLength(0);
    });

    it('is idempotent per fee reference', async () => {
      await purchase(1_000n);

      await service.applyToFee(COMPANY, 400n, 'fee-1');
      const retry = await service.applyToFee(COMPANY, 400n, 'fee-1');

      expect(retry.creditApplied).toBe(400n);
      expect(rows).toHaveLength(2);
      await expect(service.getBalance(COMPANY)).resolves.toBe(600n);
    });

    it('cannot double-spend credit under concurrent fee charges', async () => {
      await purchase(500n);

      const results = await Promise.all([
        service.applyToFee(COMPANY, 400n, 'fee-a'),
        service.applyToFee(COMPANY, 400n, 'fee-b'),
      ]);

      const applied = results.reduce((sum, r) => sum + r.creditApplied, 0n);
      expect(applied).toBe(500n);
      expect(results.reduce((sum, r) => sum + r.amountDue, 0n)).toBe(300n);
      await expect(service.getBalance(COMPANY)).resolves.toBe(0n);
      expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
    });
  });
});

describe('BillingService.chargePlatformFee with credits (#507)', () => {
  let service: BillingService;
  let credits: CreditLedgerService;

  beforeEach(() => {
    const fake = createFakePrisma();
    credits = new CreditLedgerService(fake.prisma);
    service = new BillingService(fake.prisma, {} as any, {} as any, credits);
  });

  it('charges the payment method only for what credits do not cover', async () => {
    await credits.append(COMPANY, { type: CreditLedgerEntryType.GRANT, amount: 300n });

    const charge = await service.chargePlatformFee(COMPANY, 1_000, 'card_123', 'fee-1');

    expect(charge).toMatchObject({
      amount: '1000',
      creditApplied: '300',
      amountCharged: '700',
      creditBalance: '0',
      paymentMethod: 'card_123',
      status: 'succeeded',
    });
    expect(charge.chargeId).toMatch(/^ch_/);
  });

  it('skips the payment processor entirely when credits cover the fee', async () => {
    await credits.append(COMPANY, { type: CreditLedgerEntryType.PURCHASE, amount: 5_000n });

    const charge = await service.chargePlatformFee(COMPANY, 1_000n, 'card_123', 'fee-1');

    expect(charge).toMatchObject({
      creditApplied: '1000',
      amountCharged: '0',
      creditBalance: '4000',
      paymentMethod: 'prepaid_credit',
      chargeId: null,
    });
  });

  it('fails non-positive fees without touching the ledger', async () => {
    const charge = await service.chargePlatformFee(COMPANY, 0, 'card_123', 'fee-1');

    expect(charge).toMatchObject({ status: 'failed', retryable: true });
  });

  it('rejects fractional amounts', async () => {
    await expect(service.chargePlatformFee(COMPANY, 10.5)).rejects.toBeInstanceOf(BadRequestException);
  });
});
