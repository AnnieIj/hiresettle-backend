import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RemoveScheduledJobDto {
  @ApiProperty({ description: 'Why the job is being removed (stored in the audit log)', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
