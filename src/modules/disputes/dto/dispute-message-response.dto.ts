import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DisputeMessageAuthorDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional() name?: string | null;
  @ApiPropertyOptional() email?: string | null;
}

export class DisputeMessageResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() disputeId: string;
  @ApiProperty() body: string;
  @ApiProperty() author: DisputeMessageAuthorDto;
  @ApiPropertyOptional() attachmentName?: string | null;
  @ApiPropertyOptional() attachmentSize?: number | null;
  @ApiPropertyOptional() attachmentMimeType?: string | null;
  /** Pre-signed S3 URL valid for 1 hour; null when no attachment. */
  @ApiPropertyOptional() attachmentUrl?: string | null;
  @ApiProperty() createdAt: Date;
}
