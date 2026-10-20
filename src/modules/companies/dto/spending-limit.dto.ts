import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Issue #479: DTO for setting/updating a member's spending limit. */
export class SetSpendingLimitDto {
  @ApiPropertyOptional({
    description:
      'Maximum amount (in smallest currency unit, e.g. cents) this member may fund ' +
      'across engagements. Omit or set to null to remove the cap.',
    example: 500000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  spendingLimit?: number | null;
}
