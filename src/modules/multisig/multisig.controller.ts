import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { MultisigService } from "./multisig.service";
import { RegisterSignerSetDto } from "./dto/register-signer-set.dto";
import { CreatePendingTxDto } from "./dto/create-pending-tx.dto";
import { SubmitSignatureDto } from "./dto/submit-signature.dto";

@ApiTags("multisig")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("multisig")
export class MultisigController {
  constructor(private readonly multisig: MultisigService) {}

  @Post("signer-sets")
  @ApiOperation({
    summary:
      "Register (or replace) the signer set + threshold for a company escrow account",
  })
  async registerSignerSet(
    @CurrentUser("id") userId: string,
    @Body() dto: RegisterSignerSetDto,
  ) {
    return this.multisig.registerSignerSet(userId, dto);
  }

  @Post("signer-sets/:signerSetId/pending-transactions")
  @ApiOperation({
    summary: "Open a new pending transaction awaiting signatures",
  })
  async createPendingTransaction(
    @Param("signerSetId") signerSetId: string,
    @Body() dto: CreatePendingTxDto,
  ) {
    return this.multisig.createPendingTransaction(
      signerSetId,
      dto.unsignedXdr,
      dto.description,
    );
  }

  @Post("pending-transactions/:pendingTxId/signatures")
  @ApiOperation({
    summary:
      "Submit a signature for a pending transaction; submits to Horizon automatically once the threshold is met",
  })
  async submitSignature(
    @Param("pendingTxId") pendingTxId: string,
    @Body() dto: SubmitSignatureDto,
  ) {
    return this.multisig.submitSignature(
      pendingTxId,
      dto.signerPublicKey,
      dto.signedXdr,
    );
  }

  @Get("pending-transactions/:pendingTxId")
  @ApiOperation({ summary: "Check a pending transaction's signature status" })
  async getStatus(@Param("pendingTxId") pendingTxId: string) {
    return this.multisig.getSignatureStatus(pendingTxId);
  }
}
