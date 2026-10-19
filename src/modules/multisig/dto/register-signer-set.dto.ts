import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class SignerDto {
  @ApiProperty({ description: "Stellar public key (G...) authorized to sign" })
  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @ApiProperty({
    description: "Platform user who controls this key",
    required: false,
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class RegisterSignerSetDto {
  @ApiProperty({
    description: "Stellar account address this signer set guards",
  })
  @IsString()
  @IsNotEmpty()
  escrowAccountId: string;

  @ApiProperty({
    type: [SignerDto],
    description: "Authorized signers for this escrow account",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SignerDto)
  signers: SignerDto[];

  @ApiProperty({
    description: "Number of distinct signatures required before submission",
  })
  @IsInt()
  @Min(1)
  threshold: number;
}
