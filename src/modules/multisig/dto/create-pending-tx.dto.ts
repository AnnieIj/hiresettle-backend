import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePendingTxDto {
  @ApiProperty({
    description:
      "Base64 XDR of the unsigned transaction envelope every signer will sign",
  })
  @IsString()
  @IsNotEmpty()
  unsignedXdr: string;

  @ApiProperty({
    description: "Human-readable context for this transaction",
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;
}
