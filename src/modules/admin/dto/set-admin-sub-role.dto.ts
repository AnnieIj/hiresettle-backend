import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { AdminSubRole } from '@prisma/client';

export class SetAdminSubRoleDto {
  @ApiPropertyOptional({
    enum: AdminSubRole,
    nullable: true,
    description:
      'Sub-role to assign. Pass null to clear (reverts to SUPER_ADMIN behaviour). ' +
      'FINANCE cannot impersonate users. SUPPORT cannot process refunds.',
  })
  @IsOptional()
  @IsEnum(AdminSubRole)
  subRole?: AdminSubRole | null;
}
