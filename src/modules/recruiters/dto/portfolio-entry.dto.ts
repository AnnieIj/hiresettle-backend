import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePortfolioEntryDto {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  @IsString()
  @MinLength(1)
  role: string;

  @ApiProperty({ example: 'FinTech' })
  @IsString()
  @MinLength(1)
  industry: string;

  @ApiProperty({ example: 2024 })
  @IsInt()
  @Min(1990)
  @Max(2100)
  year: number;
}

export class UpdatePortfolioEntryDto {
  @ApiProperty({ required: false, example: 'Lead Engineer' })
  @IsString()
  @MinLength(1)
  role?: string;

  @ApiProperty({ required: false, example: 'HealthTech' })
  @IsString()
  @MinLength(1)
  industry?: string;

  @ApiProperty({ required: false, example: 2025 })
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number;
}
