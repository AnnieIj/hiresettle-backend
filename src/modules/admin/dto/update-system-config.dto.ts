import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSystemConfigDto {
  @ApiProperty({
    description:
      'New value. Must match the setting type exactly: a JSON number for integer settings, true/false for ' +
      'boolean settings, and an integer string for stroops settings. Bounds are enforced per key.',
    example: 48,
  })
  @IsDefined()
  value: unknown;

  @ApiProperty({ description: 'Why the setting is being changed (stored in the audit log)', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ResetSystemConfigDto {
  @ApiProperty({ description: 'Why the override is being removed (stored in the audit log)', minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
