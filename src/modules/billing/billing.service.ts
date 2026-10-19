import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { User, UserRole } from "@prisma/client";
import { StellarService } from "../../common/stellar/stellar.service";
import { ExchangeRateService } from "../../common/exchange-rates/exchange-rate.service";
import { CreditLedgerService } from "./credit-ledger.service";

/** Round a fiat amount to 2 decimal places. */
function roundFiat(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Escape a value for safe inclusion in a CSV cell. */
function csvCell(value: string | number | null | undefined): string {
  const str = value == null ? "" : String(value);
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private static readonly usageWindowMs = 24 * 60 * 60 * 1000;
  private static readonly usageCounts = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly credits: CreditLedgerService,
  ) {}

  private static createPdfBuffer(lines: string[]) {
    const content = lines.join("\n");
    const stream = Buffer.from(content).toString("latin1");
    const objects: string[] = ["%PDF-1.4"];
    const offsets: number[] = [0];
    const contentStart = 0;
    const contentLength = Buffer.byteLength(stream, "latin1");
    objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    objects.push(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
    );
    objects.push(
      `4 0 obj\n<< /Length ${contentLength} >>\nstream\n${stream}\nendstream\nendobj`,
    );
    objects.push(
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    );

    let position = 0;
    const body: string[] = [];
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      const offset = position;
      offsets.push(offset);
      body.push(`${i} 0 obj\n${obj.replace(/^\d+ 0 obj\n/, "")}\nendobj\n`);
      position += Buffer.byteLength(body[body.length - 1], "latin1");
    }

    const xrefOffset = Buffer.byteLength(body.join(""), "latin1");
    const xref = `xref\n0 ${objects.length} \n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
      .join("")}`;
    const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(
      `%PDF-1.4\n${body.join("")}\n${xref}\n${trailer}`,
      "latin1",
    );
  }

  generateInvoiceNumber(id: string | number) {
    const seed = Number(String(id).replace(/[^0-9]/g, "") || "1");
    return `INV-${String(seed + 1000).padStart(7, "0")}`;
  }

  generateInvoicePdf(
    companyUser: User,
    invoiceId: string | number,
    fromDate?: Date,
    toDate?: Date,
    fiat?: string,
  ) {
    const billingData = this.getBillingSummary(companyUser, fromDate, toDate);
    return billingData.then(({ summary, engagementBreakdown }) => {
      const invoiceNumber = this.generateInvoiceNumber(invoiceId);
      const itemLines = engagementBreakdown.length
        ? engagementBreakdown.map(
            (item) =>
              `${item.jobTitle} (${item.engagementId})  ${item.totalEscrowed}`,
          )
        : ["No billable engagements in this period"];
      const lines = [
        "BT /F1 18 Tf 72 760 Td (HireSettle Invoice) Tj ET",
        `BT /F1 12 Tf 72 736 Td (Invoice #: ${invoiceNumber}) Tj ET`,
        `BT /F1 12 Tf 72 720 Td (Company: ${companyUser.company ?? companyUser.name ?? "N/A"}) Tj ET`,
        `BT /F1 12 Tf 72 704 Td (Contact: ${companyUser.email ?? "N/A"}) Tj ET`,
        ...itemLines.map(
          (line, index) =>
            `BT /F1 10 Tf 72 ${688 - index * 16} Td (${line}) Tj ET`,
        ),
        `BT /F1 12 Tf 72 120 Td (Total Escrowed: ${summary.totalEscrowed}) Tj ET`,
        `BT /F1 12 Tf 72 104 Td (Total Released: ${summary.totalReleased}) Tj ET`,
      ];
      return BillingService.createPdfBuffer(lines);
    });
  }

  recordCompanyUsage(companyId: string, count = 1) {
    const now = Date.now();
    const bucket = BillingService.usageCounts.get(companyId) ?? [];
    bucket.push(now, now + count);
    const valid = bucket.filter(
      (ts) => now - ts < BillingService.usageWindowMs,
    );
    BillingService.usageCounts.set(companyId, valid);
    return { companyId, total: valid.length };
  }

  getCompanyUsage(companyId: string, windowMs = BillingService.usageWindowMs) {
    const values = BillingService.usageCounts.get(companyId) ?? [];
    const now = Date.now();
    const total = values.filter((ts) => now - ts < windowMs).length;
    return {
      companyId,
      total,
      windowMs,
      period: new Date(now - windowMs).toISOString(),
    };
  }

  /**
   * Charge a platform fee (minor units). Prepaid credits are applied first
   * (#507); only the uncovered remainder goes to the external payment
   * method. `feeReference` makes the credit deduction idempotent, so a
   * retried charge never consumes credit twice.
   */
  async chargePlatformFee(
    companyId: string,
    amount: number | bigint,
    paymentMethod = "saved_method",
    feeReference = `fee_${Date.now()}`,
  ) {
    const feeAmount = toMinorUnits(amount);
    if (feeAmount <= 0n) {
      return {
        companyId,
        paymentMethod,
        amount: feeAmount.toString(),
        creditApplied: "0",
        amountCharged: "0",
        creditBalance: (await this.credits.getBalance(companyId)).toString(),
        status: "failed" as const,
        chargeId: null,
        retryable: true,
      };
    }

    const credit = await this.credits.applyToFee(companyId, feeAmount, feeReference);
    // Fully covered by credit: nothing is sent to the payment processor.
    const chargeId = credit.amountDue > 0n ? `ch_${Date.now()}` : null;

    return {
      companyId,
      paymentMethod: credit.amountDue > 0n ? paymentMethod : "prepaid_credit",
      amount: feeAmount.toString(),
      creditApplied: credit.creditApplied.toString(),
      amountCharged: credit.amountDue.toString(),
      creditBalance: credit.balanceAfter.toString(),
      status: "succeeded" as const,
      chargeId,
      retryable: false,
    };
  }

  async getBillingSummary(
    companyUser: User,
    fromDate?: Date,
    toDate?: Date,
    fiat?: string,
  ) {
    // Get current calendar month if no dates provided
    const now = new Date();
    const startDate =
      fromDate || new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate =
      toDate ||
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Find engagements where the user is the company
    const engagements = await this.prisma.engagement.findMany({
      where: {
        companyAddress: companyUser.stellarAddress,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        milestones: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Calculate aggregates
    let totalEscrowed = BigInt(0);
    let totalReleased = BigInt(0);
    let totalEscrowedFiat: number | null = null;
    let totalReleasedFiat: number | null = null;
    const fiatCurrency = fiat ? fiat.trim().toUpperCase() : null;

    const engagementBreakdown = await Promise.all(
      engagements.map(async (engagement) => {
        const escrowed = engagement.totalAmount;
        const released = engagement.releasedAmount;

        totalEscrowed += escrowed;
        totalReleased += released;

        // Optional fiat-equivalent totals, converted per token.
        const fiatValues = fiatCurrency
          ? await this.toFiatValues(engagement.tokenAddress, escrowed, released, fiatCurrency)
          : { escrowedFiat: null, releasedFiat: null, tokenSymbol: null };

        if (fiatValues.escrowedFiat != null) {
          totalEscrowedFiat =
            (totalEscrowedFiat ?? 0) + fiatValues.escrowedFiat;
        }
        if (fiatValues.releasedFiat != null) {
          totalReleasedFiat =
            (totalReleasedFiat ?? 0) + fiatValues.releasedFiat;
        }

        return {
          engagementId: engagement.id,
          jobTitle: engagement.jobTitle,
          createdAt: engagement.createdAt,
          totalEscrowed: escrowed.toString(),
          totalReleased: released.toString(),
          status: engagement.status,
          tokenSymbol: fiatValues.tokenSymbol,
          totalEscrowedFiat: fiatValues.escrowedFiat,
          totalReleasedFiat: fiatValues.releasedFiat,
        };
      }),
    );

    return {
      fromDate: startDate,
      toDate: endDate,
      fiat: fiatCurrency,
      summary: {
        totalEscrowed: totalEscrowed.toString(),
        totalReleased: totalReleased.toString(),
        totalEngagements: engagements.length,
        totalEscrowedFiat: totalEscrowedFiat == null ? null : roundFiat(totalEscrowedFiat),
        totalReleasedFiat: totalReleasedFiat == null ? null : roundFiat(totalReleasedFiat),
      },
      engagementBreakdown,
    };
  }

  private async toFiatValues(
    tokenAddress: string,
    escrowed: bigint,
    released: bigint,
    fiat: string,
  ): Promise<{ escrowedFiat: number | null; releasedFiat: number | null; tokenSymbol: string | null }> {
    try {
      const token = this.stellar.getTokenConfig(tokenAddress);
      const rate = await this.exchangeRates.getRate(token.symbol, fiat);
      if (rate == null) {
        return { escrowedFiat: null, releasedFiat: null, tokenSymbol: token.symbol };
      }

      const escrowedHuman = parseFloat(this.stellar.stroopsToHuman(escrowed, tokenAddress));
      const releasedHuman = parseFloat(this.stellar.stroopsToHuman(released, tokenAddress));
      return {
        escrowedFiat: roundFiat(escrowedHuman * rate),
        releasedFiat: roundFiat(releasedHuman * rate),
        tokenSymbol: token.symbol,
      };
    } catch (error: any) {
      this.logger.warn(
        `Fiat conversion skipped for token ${tokenAddress}: ${error?.message ?? String(error)}`,
      );
      return { escrowedFiat: null, releasedFiat: null, tokenSymbol: null };
    }
  }

  async exportBillingToCsv(
    companyUser: User,
    fromDate?: Date,
    toDate?: Date,
    fiat?: string,
  ) {
    const billingData = await this.getBillingSummary(
      companyUser,
      fromDate,
      toDate,
      fiat,
    );
    const fiatCurrency = billingData.fiat;

    // Build CSV header — fiat columns only when a fiat currency is requested.
    const headers = [
      "Engagement ID",
      "Job Title",
      "Created At",
      "Token",
      "Total Escrowed",
      "Total Released",
      "Status",
      ...(fiatCurrency
        ? [`Total Escrowed (${fiatCurrency})`, `Total Released (${fiatCurrency})`]
        : []),
    ];

    // Build CSV rows
    const rows = billingData.engagementBreakdown.map((item) => [
      item.engagementId,
      `"${item.jobTitle.replace(/"/g, '""')}"`, // Escape quotes
      item.createdAt.toISOString(),
      item.tokenSymbol ?? '',
      item.totalEscrowed,
      item.totalReleased,
      item.status,
      ...(fiatCurrency
        ? [item.totalEscrowedFiat ?? '', item.totalReleasedFiat ?? '']
        : []),
    ]);

    // Add summary row
    const summaryRow = [
      "Summary",
      "",
      "",
      "",
      billingData.summary.totalEscrowed,
      billingData.summary.totalReleased,
      `${billingData.summary.totalEngagements} engagements`,
      ...(fiatCurrency
        ? [billingData.summary.totalEscrowedFiat ?? '', billingData.summary.totalReleasedFiat ?? '']
        : []),
    ];

    // Combine all parts
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
      "",
      summaryRow.join(","),
    ].join("\n");

    return csvContent;
  }

  /**
   * Export billing history as a CSV.
   *
   * Scoping rules:
   *   - COMPANY: only their own engagements (filtered by stellarAddress)
   *   - ADMIN:   all engagements in the system
   *
   * Columns (acceptance criteria): date, engagement reference, amount, status
   */
  async exportBillingHistory(
    requestingUser: User,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<string> {
    const isAdmin = requestingUser.role === UserRole.ADMIN;

    const now = new Date();
    const startDate =
      fromDate ?? new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate =
      toDate ??
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const where: Parameters<
      typeof this.prisma.engagement.findMany
    >[0]["where"] = {
      createdAt: { gte: startDate, lte: endDate },
      // Admins see everything; companies see only their own
      ...(!isAdmin && { companyAddress: requestingUser.stellarAddress }),
    };

    const engagements = await this.prisma.engagement.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const CSV_HEADER = buildCsvRow([
      "Date",
      "Engagement Reference",
      "Amount (stroops)",
      "Status",
    ]);

    const rows = engagements.map((e) =>
      buildCsvRow([
        e.createdAt.toISOString(),
        e.id,
        e.totalAmount.toString(),
        e.status,
      ]),
    );

    return [CSV_HEADER, ...rows].join("\n");
  }
}

/** Fees are integer minor units; reject fractional or non-finite numbers. */
function toMinorUnits(amount: number | bigint): bigint {
  if (typeof amount === "bigint") return amount;
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new BadRequestException("Fee amount must be an integer number of minor units");
  }
  return BigInt(amount);
}
