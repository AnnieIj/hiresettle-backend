/**
 * Issue #478 — Email bounce and complaint handling.
 *
 * This service:
 *  1. Processes SNS/SES webhook payloads (bounces & complaints).
 *  2. Persists the suppressed address so future sends are blocked.
 *  3. Exposes an admin API for listing / removing suppressed addresses.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EmailSuppressionReason } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface SnsNotification {
  Type: string;
  Message: string;
  MessageId?: string;
}

export interface SesEventRecord {
  eventType?: string;
  notificationType?: string;
  bounce?: {
    bounceType: string; // 'Permanent' | 'Transient'
    bouncedRecipients: { emailAddress: string }[];
  };
  complaint?: {
    complainedRecipients: { emailAddress: string }[];
  };
}

@Injectable()
export class BounceService {
  private readonly logger = new Logger(BounceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Handle an inbound SNS notification from SES. */
  async handleSnsNotification(payload: SnsNotification): Promise<void> {
    let record: SesEventRecord;
    try {
      record = JSON.parse(payload.Message) as SesEventRecord;
    } catch {
      throw new BadRequestException('Invalid SNS Message payload');
    }

    const type = record.eventType ?? record.notificationType ?? '';
    const sourceId = payload.MessageId;

    if (type === 'Bounce' && record.bounce?.bounceType === 'Permanent') {
      for (const r of record.bounce.bouncedRecipients) {
        await this.suppress(r.emailAddress, EmailSuppressionReason.HARD_BOUNCE, sourceId);
      }
    } else if (type === 'Complaint' && record.complaint) {
      for (const r of record.complaint.complainedRecipients) {
        await this.suppress(r.emailAddress, EmailSuppressionReason.COMPLAINT, sourceId);
      }
    }
  }

  /** Suppress an email address (idempotent). */
  async suppress(
    email: string,
    reason: EmailSuppressionReason,
    sourceId?: string,
  ): Promise<void> {
    await this.prisma.suppressedEmail.upsert({
      where: { email },
      update: { reason, sourceId: sourceId ?? null },
      create: { email, reason, sourceId: sourceId ?? null },
    });
    this.logger.warn(`Suppressed email address: ${email} (${reason})`);
  }

  /** Return true if the address is on the suppression list. */
  async isSuppressed(email: string): Promise<boolean> {
    const row = await this.prisma.suppressedEmail.findUnique({ where: { email } });
    return row !== null;
  }

  /** Admin: list all suppressed addresses, newest first. */
  async listSuppressed(skip = 0, take = 50) {
    return this.prisma.suppressedEmail.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /** Admin: remove a suppressed address. */
  async removeSuppressed(email: string) {
    return this.prisma.suppressedEmail.delete({ where: { email } });
  }
}
