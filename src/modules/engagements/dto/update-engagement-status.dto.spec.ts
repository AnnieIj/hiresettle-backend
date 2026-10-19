import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EngagementStatus } from '@prisma/client';
import { UpdateEngagementStatusDto } from './update-engagement-status.dto';

/**
 * #468: a status change (in particular a cancellation) without a reason
 * must be rejected with a validation error, which the global ValidationPipe
 * turns into a 400. A whitespace-only reason must be rejected too.
 */
describe('UpdateEngagementStatusDto (#468)', () => {
  const validate_ = async (body: Record<string, unknown>) => {
    const dto = plainToInstance(UpdateEngagementStatusDto, body);
    return validate(dto);
  };

  it('rejects a cancellation with no reason', async () => {
    const errors = await validate_({ status: EngagementStatus.CANCELLED });
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });

  it('rejects a cancellation with an empty-string reason', async () => {
    const errors = await validate_({ status: EngagementStatus.CANCELLED, reason: '' });
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });

  it('rejects a cancellation with a whitespace-only reason', async () => {
    const errors = await validate_({ status: EngagementStatus.CANCELLED, reason: '   ' });
    expect(errors.some((e) => e.property === 'reason')).toBe(true);
  });

  it('accepts a cancellation with a real reason', async () => {
    const errors = await validate_({ status: EngagementStatus.CANCELLED, reason: 'Candidate withdrew' });
    expect(errors).toHaveLength(0);
  });

  it('trims the reason before validation', async () => {
    const dto = plainToInstance(UpdateEngagementStatusDto, {
      status: EngagementStatus.CANCELLED,
      reason: '  Candidate withdrew  ',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.reason).toBe('Candidate withdrew');
  });
});
