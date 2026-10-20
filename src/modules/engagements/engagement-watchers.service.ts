import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * EngagementWatchersService — manages watcher subscriptions on engagements (#443).
 *
 * Watchers receive notifications when engagement status changes without being
 * direct parties (company / recruiter / arbiter).  This service is intentionally
 * kept small and separate from EngagementsService to make it easy to extend.
 *
 * NOTE: The `EngagementWatcher` Prisma model must be added to schema.prisma
 * before the DB methods below are un-stubbed.  Until then every mutating call
 * returns a typed placeholder so the controller and module compile cleanly.
 */
@Injectable()
export class EngagementWatchersService {
  private readonly logger = new Logger(EngagementWatchersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add `userId` as a watcher of `engagementId`.
   * Throws 404 if the engagement doesn't exist, 409 if already watching.
   */
  async addWatcher(engagementId: string, userId: string): Promise<{ engagementId: string; userId: string }> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);

    // TODO: once EngagementWatcher model exists in schema.prisma, replace the
    // stub below with:
    //   const existing = await this.prisma.engagementWatcher.findUnique({
    //     where: { engagementId_userId: { engagementId, userId } },
    //   });
    //   if (existing) throw new ConflictException('Already watching this engagement');
    //   return this.prisma.engagementWatcher.create({ data: { engagementId, userId } });

    this.logger.warn(`addWatcher: EngagementWatcher model not yet in schema — returning stub`);
    return { engagementId, userId };
  }

  /**
   * Remove `userId` from the watcher list of `engagementId`.
   * Throws 404 if the engagement or watcher record doesn't exist.
   */
  async removeWatcher(engagementId: string, userId: string): Promise<{ success: boolean }> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);

    // TODO: once EngagementWatcher model exists in schema.prisma, replace stub:
    //   const existing = await this.prisma.engagementWatcher.findUnique({
    //     where: { engagementId_userId: { engagementId, userId } },
    //   });
    //   if (!existing) throw new NotFoundException('You are not watching this engagement');
    //   await this.prisma.engagementWatcher.delete({
    //     where: { engagementId_userId: { engagementId, userId } },
    //   });

    this.logger.warn(`removeWatcher: EngagementWatcher model not yet in schema — returning stub`);
    return { success: true };
  }

  /**
   * Return all watcher user-IDs for an engagement.
   */
  async listWatchers(engagementId: string): Promise<string[]> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id: engagementId },
    });
    if (!engagement) throw new NotFoundException(`Engagement ${engagementId} not found`);

    // TODO: once EngagementWatcher model exists in schema.prisma, replace stub:
    //   const watchers = await this.prisma.engagementWatcher.findMany({
    //     where: { engagementId },
    //     select: { userId: true },
    //   });
    //   return watchers.map((w) => w.userId);

    this.logger.warn(`listWatchers: EngagementWatcher model not yet in schema — returning empty list`);
    return [];
  }
}
