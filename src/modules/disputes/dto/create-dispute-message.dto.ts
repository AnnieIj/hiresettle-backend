import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateDisputeMessageDto {
  @ApiProperty({
    description: 'Message body visible to all dispute participants',
    maxLength: 10_000,
    example: 'I have attached the signed placement agreement as evidence.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body: string;
}
