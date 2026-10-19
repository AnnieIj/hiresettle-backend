import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePortfolioEntryDto, UpdatePortfolioEntryDto } from './dto/portfolio-entry.dto';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  async listEntries(recruiterId: string) {
    return this.prisma.recruiterPortfolioEntry.findMany({
      where: { recruiterId },
      orderBy: { year: 'desc' },
      select: { id: true, role: true, industry: true, year: true, createdAt: true },
    });
  }

  async createEntry(recruiterId: string, dto: CreatePortfolioEntryDto) {
    return this.prisma.recruiterPortfolioEntry.create({
      data: { recruiterId, role: dto.role, industry: dto.industry, year: dto.year },
      select: { id: true, role: true, industry: true, year: true, createdAt: true },
    });
  }

  async updateEntry(recruiterId: string, entryId: string, dto: UpdatePortfolioEntryDto) {
    const entry = await this.prisma.recruiterPortfolioEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Portfolio entry not found');
    if (entry.recruiterId !== recruiterId) throw new ForbiddenException('Not your portfolio entry');

    return this.prisma.recruiterPortfolioEntry.update({
      where: { id: entryId },
      data: { ...(dto.role !== undefined && { role: dto.role }), ...(dto.industry !== undefined && { industry: dto.industry }), ...(dto.year !== undefined && { year: dto.year }) },
      select: { id: true, role: true, industry: true, year: true, updatedAt: true },
    });
  }

  async deleteEntry(recruiterId: string, entryId: string) {
    const entry = await this.prisma.recruiterPortfolioEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Portfolio entry not found');
    if (entry.recruiterId !== recruiterId) throw new ForbiddenException('Not your portfolio entry');

    await this.prisma.recruiterPortfolioEntry.delete({ where: { id: entryId } });
  }
}
