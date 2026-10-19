import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { EngagementsService } from './engagements.service';
import { CreateEngagementDto } from './dto/create-engagement.dto';

/**
 * EngagementImportService — handles CSV bulk-import of engagements (#443 / #254).
 *
 * Parses a multipart CSV upload and attempts to create each row as an engagement
 * via EngagementsService.create().  Invalid rows are collected in the errors report
 * without stopping the rest of the batch.
 *
 * Expected CSV columns:
 *   engagementId, companyAddress, recruiterAddress, arbiterAddress, tokenAddress,
 *   totalAmount, jobTitle, jobDescription (opt), salaryRange (opt), location (opt),
 *   tags (opt, pipe-separated — e.g. "engineering|urgent")
 *
 * The CSV must include a header row.
 */
@Injectable()
export class EngagementImportService {
  private readonly logger = new Logger(EngagementImportService.name);

  private static readonly REQUIRED_COLUMNS = [
    'engagementId',
    'companyAddress',
    'recruiterAddress',
    'arbiterAddress',
    'tokenAddress',
    'totalAmount',
    'jobTitle',
  ] as const;

  constructor(
    // EngagementsService is injected to reuse existing create() validation / persistence logic.
    private readonly engagementsService: EngagementsService,
  ) {}

  /**
   * Parse the CSV buffer, validate headers, then create each row as an engagement.
   * Returns a summary report with per-row success / failure details.
   */
  async importFromCsv(
    user: User,
    file: Express.Multer.File,
  ): Promise<{
    totalRows: number;
    successCount: number;
    failureCount: number;
    results: Array<{ row: number; engagementId?: string; success: boolean; error?: string }>;
  }> {
    if (!file?.buffer) {
      throw new BadRequestException('No file provided or file is empty');
    }

    const csv = file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV file must contain a header row and at least one data row',
      );
    }

    const headers = lines[0].split(',').map((h) => h.trim());
    const missingRequired = EngagementImportService.REQUIRED_COLUMNS.filter(
      (c) => !headers.includes(c),
    );
    if (missingRequired.length > 0) {
      throw new BadRequestException(
        `CSV is missing required column(s): ${missingRequired.join(', ')}`,
      );
    }

    const results: Array<{
      row: number;
      engagementId?: string;
      success: boolean;
      error?: string;
    }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1; // 1-based, header is row 1
      try {
        const values = this.parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx]?.trim() ?? '';
        });

        // Per-row required-field validation
        const rowMissing = EngagementImportService.REQUIRED_COLUMNS.filter((c) => !row[c]);
        if (rowMissing.length > 0) {
          throw new Error(`Missing required field(s): ${rowMissing.join(', ')}`);
        }

        const dto: CreateEngagementDto = {
          engagementId: row['engagementId'],
          companyAddress: row['companyAddress'],
          recruiterAddress: row['recruiterAddress'],
          arbiterAddress: row['arbiterAddress'],
          tokenAddress: row['tokenAddress'],
          totalAmount: row['totalAmount'],
          jobTitle: row['jobTitle'],
          jobDescription: row['jobDescription'] || undefined,
          salaryRange: row['salaryRange'] || undefined,
          location: row['location'] || undefined,
          tags: row['tags']
            ? row['tags']
                .split('|')
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
          // CSV import does not support inline milestone configuration — use templates for that.
          milestones: [],
        };

        await this.engagementsService.create(user, dto);
        successCount++;
        results.push({ row: rowNum, engagementId: dto.engagementId, success: true });
      } catch (error) {
        failureCount++;
        results.push({
          row: rowNum,
          success: false,
          error: error.message ?? String(error),
        });
        this.logger.warn(`CSV import row ${rowNum} failed: ${error.message}`);
      }
    }

    this.logger.log(
      `CSV import complete: ${successCount} created, ${failureCount} failed`,
    );

    return {
      totalRows: lines.length - 1,
      successCount,
      failureCount,
      results,
    };
  }

  /** Splits a single CSV line, handling double-quoted fields with escaped quotes. */
  parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote inside a quoted field
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }
}
