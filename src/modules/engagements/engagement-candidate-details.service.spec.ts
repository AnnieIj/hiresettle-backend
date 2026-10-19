import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EngagementCandidateDetailsService } from './engagement-candidate-details.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// Use string literals because @prisma/client enums are not available in the Jest mock environment
const MilestoneStatus = {
  PENDING: 'PENDING',
  LOCKED: 'LOCKED',
  CONFIRMED: 'CONFIRMED',
  RESOLVED: 'RESOLVED',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  engagement: {
    findUnique: jest.fn(),
  },
});

const baseEngagement = {
  id: 'ENG-001',
  clientId: 'user-company',
  freelancerId: 'user-recruiter',
  milestones: [],
};

// ---------------------------------------------------------------------------

describe('EngagementCandidateDetailsService', () => {
  let service: EngagementCandidateDetailsService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementCandidateDetailsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EngagementCandidateDetailsService>(EngagementCandidateDetailsService);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getSummary()
  // -------------------------------------------------------------------------

  describe('getSummary()', () => {
    it('returns zeroed amounts when no milestones exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...baseEngagement, milestones: [] });

      const result = await service.getSummary('ENG-001', 'user-company');

      expect(result).toEqual({
        totalAmount: '0',
        releasedAmount: '0',
        lockedAmount: '0',
        milestonesTotal: 0,
        milestonesCompleted: 0,
      });
    });

    it('correctly sums milestone amounts and counts completed milestones', async () => {
      const milestones = [
        { amount: BigInt(3_000_000_000), status: MilestoneStatus.CONFIRMED },
        { amount: BigInt(2_000_000_000), status: MilestoneStatus.PENDING },
        { amount: BigInt(1_500_000_000), status: MilestoneStatus.RESOLVED },
      ];
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...baseEngagement, milestones });

      const result = await service.getSummary('ENG-001', 'user-recruiter');

      expect(result.totalAmount).toBe('6500000000');
      expect(result.releasedAmount).toBe('4500000000'); // CONFIRMED + RESOLVED
      expect(result.lockedAmount).toBe('2000000000');  // PENDING
      expect(result.milestonesTotal).toBe(3);
      expect(result.milestonesCompleted).toBe(2);
    });

    it('handles BigInt amounts stored as string (coercion)', async () => {
      const milestones = [
        { amount: '5000000000' as any, status: MilestoneStatus.CONFIRMED },
      ];
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...baseEngagement, milestones });

      const result = await service.getSummary('ENG-001', 'user-company');

      expect(result.totalAmount).toBe('5000000000');
      expect(result.releasedAmount).toBe('5000000000');
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.getSummary('MISSING', 'user-company')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when user is not company or recruiter', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...baseEngagement });

      await expect(service.getSummary('ENG-001', 'user-outsider')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns correct summary when all milestones are locked (no releases)', async () => {
      const milestones = [
        { amount: BigInt(1_000_000_000), status: MilestoneStatus.LOCKED },
        { amount: BigInt(1_000_000_000), status: MilestoneStatus.PENDING },
      ];
      mockPrisma.engagement.findUnique.mockResolvedValue({ ...baseEngagement, milestones });

      const result = await service.getSummary('ENG-001', 'user-company');

      expect(result.releasedAmount).toBe('0');
      expect(result.lockedAmount).toBe('2000000000');
      expect(result.milestonesCompleted).toBe(0);
    });
  });
});
