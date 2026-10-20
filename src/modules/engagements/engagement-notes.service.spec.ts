import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EngagementNotesService } from './engagement-notes.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// Use string literals because @prisma/client enums are not available in the Jest mock environment
const UserRole = {
  COMPANY: 'COMPANY',
  RECRUITER: 'RECRUITER',
  ARBITER: 'ARBITER',
  ADMIN: 'ADMIN',
} as const;

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  engagement: {
    findUnique: jest.fn(),
  },
  engagementNote: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
});

const baseEngagement = {
  id: 'ENG-001',
  companyAddress: 'GCOMPANY',
  recruiterAddress: 'GRECRUITER',
  arbiterAddress: 'GARBITER',
};

const companyUser = {
  id: 'user-company',
  stellarAddress: 'GCOMPANY',
  role: UserRole.COMPANY,
};

const recruiterUser = {
  id: 'user-recruiter',
  stellarAddress: 'GRECRUITER',
  role: UserRole.RECRUITER,
};

const outsiderUser = {
  id: 'user-outsider',
  stellarAddress: 'GSTRANGER',
  role: UserRole.COMPANY,
};

const adminUser = {
  id: 'user-admin',
  stellarAddress: 'GADMIN',
  role: UserRole.ADMIN,
};

// ---------------------------------------------------------------------------

describe('EngagementNotesService', () => {
  let service: EngagementNotesService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementNotesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EngagementNotesService>(EngagementNotesService);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // createNote()
  // -------------------------------------------------------------------------

  describe('createNote()', () => {
    const note = { id: 'note-1', engagementId: 'ENG-001', authorId: 'user-company', body: 'Test note' };

    it('creates a note for a participant (company)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.create.mockResolvedValue(note);

      const result = await service.createNote('ENG-001', companyUser, 'Test note');

      expect(result).toEqual(note);
      expect(mockPrisma.engagementNote.create).toHaveBeenCalledWith({
        data: { engagementId: 'ENG-001', authorId: companyUser.id, body: 'Test note' },
      });
    });

    it('creates a note for a participant (recruiter)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.create.mockResolvedValue({ ...note, authorId: 'user-recruiter' });

      const result = await service.createNote('ENG-001', recruiterUser, 'Another note');
      expect(result).toBeDefined();
    });

    it('creates a note for an ADMIN (non-participant bypass)', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.create.mockResolvedValue({ ...note, authorId: 'user-admin' });

      const result = await service.createNote('ENG-001', adminUser, 'Admin note');
      expect(result).toBeDefined();
      expect(mockPrisma.engagementNote.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.createNote('MISSING', companyUser, 'Note')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.engagementNote.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a non-participant', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);

      await expect(service.createNote('ENG-001', outsiderUser, 'Note')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.engagementNote.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a user with no stellarAddress', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      const noAddress = { id: 'x', stellarAddress: undefined, role: UserRole.COMPANY };

      await expect(service.createNote('ENG-001', noAddress, 'Note')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // findNotes()
  // -------------------------------------------------------------------------

  describe('findNotes()', () => {
    const notes = [
      { id: 'n1', engagementId: 'ENG-001', body: 'First' },
      { id: 'n2', engagementId: 'ENG-001', body: 'Second' },
    ];

    it('returns notes in chronological order for a participant', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.findMany.mockResolvedValue(notes);

      const result = await service.findNotes('ENG-001', companyUser);

      expect(result).toEqual(notes);
      expect(mockPrisma.engagementNote.findMany).toHaveBeenCalledWith({
        where: { engagementId: 'ENG-001' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns empty array when no notes exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.findMany.mockResolvedValue([]);

      const result = await service.findNotes('ENG-001', recruiterUser);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when engagement does not exist', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(null);

      await expect(service.findNotes('MISSING', companyUser)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for a non-participant', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);

      await expect(service.findNotes('ENG-001', outsiderUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows ADMIN to read notes without being a participant', async () => {
      mockPrisma.engagement.findUnique.mockResolvedValue(baseEngagement);
      mockPrisma.engagementNote.findMany.mockResolvedValue(notes);

      const result = await service.findNotes('ENG-001', adminUser);
      expect(result).toEqual(notes);
    });
  });

  // -------------------------------------------------------------------------
  // checkParticipant() — unit test the guard directly
  // -------------------------------------------------------------------------

  describe('checkParticipant()', () => {
    it('does not throw for ADMIN regardless of address', () => {
      expect(() =>
        service.checkParticipant(baseEngagement, { stellarAddress: 'GNOBODY', role: UserRole.ADMIN }),
      ).not.toThrow();
    });

    it('does not throw when the user is the company', () => {
      expect(() =>
        service.checkParticipant(baseEngagement, companyUser),
      ).not.toThrow();
    });

    it('does not throw when the user is the arbiter', () => {
      expect(() =>
        service.checkParticipant(baseEngagement, { stellarAddress: 'GARBITER', role: UserRole.ARBITER }),
      ).not.toThrow();
    });

    it('throws ForbiddenException for an unrelated user', () => {
      expect(() =>
        service.checkParticipant(baseEngagement, outsiderUser),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when stellarAddress is undefined', () => {
      expect(() =>
        service.checkParticipant(baseEngagement, { stellarAddress: undefined, role: UserRole.COMPANY }),
      ).toThrow(ForbiddenException);
    });
  });
});
