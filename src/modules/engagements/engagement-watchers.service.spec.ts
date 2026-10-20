import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EngagementWatchersService } from './engagement-watchers.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  engagement: {
    findUnique: jest.fn(),
  },
});

const baseEngagement = {
  id: 'ENG-001',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
  arbiterAddress: 'GARBITER',
};

// ---------------------------------------------------------------------------

describe('EngagementWatchersService', () => {
  let service: EngagementWatchersService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementWatchersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EngagementWatchersService>(EngagementWatchersService);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // addWatcher()
  // -------------------------------------------------------------------------

  describe('addWatcher()', () => {
    it('returns the engagementId and userId on success (stub)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);

      const result = await service.addWatcher('ENG-001', 'user-watcher');

      expect(result).toEqual({ engagementId: 'ENG-001', userId: 'user-watcher' });
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.addWatcher('MISSING', 'user-watcher')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // removeWatcher()
  // -------------------------------------------------------------------------

  describe('removeWatcher()', () => {
    it('returns { success: true } on success (stub)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);

      const result = await service.removeWatcher('ENG-001', 'user-watcher');

      expect(result).toEqual({ success: true });
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.removeWatcher('MISSING', 'user-watcher')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // listWatchers()
  // -------------------------------------------------------------------------

  describe('listWatchers()', () => {
    it('returns an empty array (stub — schema model pending)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);

      const result = await service.listWatchers('ENG-001');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.listWatchers('MISSING')).rejects.toThrow(NotFoundException);
    });
  });
});
