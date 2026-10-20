import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EngagementStatus } from '@prisma/client';

export class UpdateEngagementStatusDto {
  @ApiProperty({ enum: EngagementStatus, example: EngagementStatus.CANCELLED })
  @IsEnum(EngagementStatus)
  @IsNotEmpty()
  status: EngagementStatus;

  // Required for every admin status override, and specifically for CANCELLED
  // (#468) so audits and disputes have context for why an engagement ended.
  // Trimmed before validation so a whitespace-only value is rejected too.
  @ApiProperty({ example: 'Legal hold initiated.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'reason must not be empty' })
  reason: string;
}
