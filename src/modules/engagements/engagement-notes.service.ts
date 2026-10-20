import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * EngagementNotesService — manages internal notes (comments) on engagements (#443).
 *
 * Notes are visible only to participants of the engagement (company, recruiter,
 * arbiter) and to ADMINs.
 */
@Injectable()
export class EngagementNotesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add a new note to an engagement.
   * Only engagement participants and ADMINs may post notes.
   */
  async createNote(
    engagementId: string,
    user: { id: string; stellarAddress?: string; role: string },
    body: string,
  ) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);

    this.checkParticipant(engagement, user);

    return this.prisma.engagementNote.create({
      data: { engagementId, authorId: user.id, body },
    });
  }

  /**
   * Return all notes for an engagement in chronological order.
   * Only engagement participants and ADMINs may read notes.
   */
  async findNotes(
    engagementId: string,
    user: { id: string; stellarAddress?: string; role: string },
  ) {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);

    this.checkParticipant(engagement, user);

    return this.prisma.engagementNote.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Verify that `user` is a participant of `engagement` (or an ADMIN).
   * Throws ForbiddenException if the check fails.
   */
  checkParticipant(
    engagement: { companyAddress: string; recruiterAddress: string; arbiterAddress: string },
    user: { stellarAddress?: string; role: string },
  ): void {
    if (user.role === 'ADMIN') return;
    const parties = [
      engagement.companyAddress,
      engagement.recruiterAddress,
      engagement.arbiterAddress,
    ];
    if (!user.stellarAddress || !parties.includes(user.stellarAddress)) {
      throw new ForbiddenException('You are not a participant of this engagement');
    }
  }
}
