import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EngagementImportService } from './engagement-import.service';
import { EngagementsService } from './engagements.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express.Multer.File from a raw string. */
function makeCsvFile(content: string): Express.Multer.File {
  return {
    buffer: Buffer.from(content, 'utf-8'),
    originalname: 'engagements.csv',
    mimetype: 'text/csv',
    fieldname: 'file',
    encoding: '7bit',
    size: content.length,
    stream: null as any,
    destination: '',
    filename: '',
    path: '',
  };
}

const VALID_HEADER =
  'engagementId,companyAddress,recruiterAddress,arbiterAddress,tokenAddress,totalAmount,jobTitle';

const makeRow = (id: string) =>
  `${id},GCOMPANY,GRECRUITER,GARBITER,CTOKEN,5000000000,Job ${id}`;

// ---------------------------------------------------------------------------

describe('EngagementImportService', () => {
  let service: EngagementImportService;
  let mockEngagementsService: jest.Mocked<Pick<EngagementsService, 'create'>>;

  beforeEach(async () => {
    mockEngagementsService = {
      create: jest.fn().mockResolvedValue({ id: 'ENG-X', totalAmount: '5000000000', releasedAmount: '0', milestones: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementImportService,
        { provide: EngagementsService, useValue: mockEngagementsService },
      ],
    }).compile();

    service = module.get<EngagementImportService>(EngagementImportService);
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // importFromCsv()
  // -------------------------------------------------------------------------

  describe('importFromCsv()', () => {
    const user = { id: 'user-1', role: 'COMPANY' } as any;

    it('successfully imports all valid rows', async () => {
      const csv = [VALID_HEADER, makeRow('ENG-001'), makeRow('ENG-002')].join('\n');
      mockEngagementsService.create.mockResolvedValue({ id: 'ok', totalAmount: '0', releasedAmount: '0', milestones: [] } as any);

      const result = await service.importFromCsv(user, makeCsvFile(csv));

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
    });

    it('reports per-row failure without aborting the batch', async () => {
      const csv = [VALID_HEADER, makeRow('ENG-001'), makeRow('ENG-002')].join('\n');
      mockEngagementsService.create
        .mockResolvedValueOnce({ id: 'ENG-001', totalAmount: '0', releasedAmount: '0', milestones: [] } as any)
        .mockRejectedValueOnce(new Error('Engagement ENG-002 already exists'));

      const result = await service.importFromCsv(user, makeCsvFile(csv));

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toContain('ENG-002 already exists');
    });

    it('throws BadRequestException when no file is provided', async () => {
      await expect(service.importFromCsv(user, null as any)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file has no buffer', async () => {
      await expect(service.importFromCsv(user, { buffer: null } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when CSV has only a header and no data rows', async () => {
      const csv = VALID_HEADER;
      await expect(service.importFromCsv(user, makeCsvFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when required columns are missing', async () => {
      const csv = ['engagementId,companyAddress', 'ENG-001,GCOMPANY'].join('\n');
      await expect(service.importFromCsv(user, makeCsvFile(csv))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('skips a row that is missing a per-row required field', async () => {
      // Missing totalAmount value on second row
      const csv = [
        VALID_HEADER,
        makeRow('ENG-001'),
        'ENG-002,GCOMPANY,GRECRUITER,GARBITER,CTOKEN,,Missing Amount', // empty totalAmount
      ].join('\n');
      mockEngagementsService.create.mockResolvedValue({ id: 'ENG-001' } as any);

      const result = await service.importFromCsv(user, makeCsvFile(csv));

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[1].error).toMatch(/Missing required field/i);
    });

    it('parses pipe-separated tags and passes them to create()', async () => {
      const csv = [
        VALID_HEADER + ',tags',
        makeRow('ENG-001') + ',engineering|urgent',
      ].join('\n');
      mockEngagementsService.create.mockResolvedValue({ id: 'ENG-001' } as any);

      await service.importFromCsv(user, makeCsvFile(csv));

      expect(mockEngagementsService.create).toHaveBeenCalledWith(
        user,
        expect.objectContaining({ tags: ['engineering', 'urgent'] }),
      );
    });

    it('handles Windows-style CRLF line endings', async () => {
      const csv = [VALID_HEADER, makeRow('ENG-001')].join('\r\n');
      mockEngagementsService.create.mockResolvedValue({ id: 'ENG-001' } as any);

      const result = await service.importFromCsv(user, makeCsvFile(csv));

      expect(result.successCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // parseCsvLine() — unit tests for the CSV tokeniser
  // -------------------------------------------------------------------------

  describe('parseCsvLine()', () => {
    it('splits a plain comma-separated line', () => {
      expect(service.parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('preserves commas inside quoted fields', () => {
      expect(service.parseCsvLine('"hello, world",b')).toEqual(['hello, world', 'b']);
    });

    it('handles escaped double-quotes inside quoted fields', () => {
      expect(service.parseCsvLine('"say ""hi""",b')).toEqual(['say "hi"', 'b']);
    });

    it('returns a single-element array for a line with no commas', () => {
      expect(service.parseCsvLine('onlyvalue')).toEqual(['onlyvalue']);
    });

    it('returns empty strings for consecutive commas', () => {
      expect(service.parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
    });
  });
});
