import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EngagementSummaryDto } from './dto/engagement-summary.dto';

/**
 * EngagementCandidateDetailsService — surfaces candidate-centric views of an
 * engagement (#443).
 *
 * This service owns anything that is specifically about the candidate / recruiter
 * side of an engagement — primarily the financial summary (how much has been
 * released vs locked) and any future candidate-profile enrichment.
 */
@Injectable()
export class EngagementCandidateDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate and return the aggregated financial summary for an engagement.
   *
   * Access is restricted to the company and recruiter of the engagement.
   */
  async getSummary(engagementId: string, userId: string): Promise<EngagementSummaryDto> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
      include: { milestones: true },
    });

    if (!engagement) {
      throw new NotFoundException('Engagement not found');
    }

    if (
      engagement.clientId !== userId &&
      engagement.freelancerId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this engagement');
    }

    let totalAmount = BigInt(0);
    let releasedAmount = BigInt(0);
    let milestonesCompleted = 0;

    for (const milestone of engagement.milestones) {
      const amount =
        typeof milestone.amount === 'bigint'
          ? milestone.amount
          : BigInt(milestone.amount as any);
      totalAmount += amount;

      if (
        milestone.status === 'CONFIRMED' ||
        milestone.status === 'RESOLVED'
      ) {
        releasedAmount += amount;
        milestonesCompleted++;
      }
    }

    const lockedAmount = totalAmount - releasedAmount;

    return {
      totalAmount: totalAmount.toString(),
      releasedAmount: releasedAmount.toString(),
      lockedAmount: lockedAmount.toString(),
      milestonesTotal: engagement.milestones.length,
      milestonesCompleted,
    };
  }
}
