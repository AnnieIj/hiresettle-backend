import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class SubmitSignatureDto {
  @ApiProperty({
    description: "Stellar public key of the signer submitting this signature",
  })
  @IsString()
  @IsNotEmpty()
  signerPublicKey: string;

  @ApiProperty({
    description:
      "Base64 XDR of the signer's own signed copy of the pending transaction's envelope",
  })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
