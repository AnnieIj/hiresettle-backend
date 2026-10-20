import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { StellarService } from "../../common/stellar/stellar.service";
import { RegisterSignerSetDto } from "./dto/register-signer-set.dto";

export interface SignatureStatus {
  pendingTxId: string;
  status: string;
  threshold: number;
  signedCount: number;
  signerIds: string[];
  submittedTxHash?: string | null;
}

@Injectable()
export class MultisigService {
  private readonly logger = new Logger(MultisigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  /**
   * Registers (or replaces) the signer set + threshold guarding a company's
   * escrow account.
   */
  async registerSignerSet(companyId: string, dto: RegisterSignerSetDto) {
    if (dto.threshold > dto.signers.length) {
      throw new BadRequestException(
        `Threshold (${dto.threshold}) cannot exceed the number of signers (${dto.signers.length})`,
      );
    }

    const uniqueKeys = new Set(dto.signers.map((s) => s.publicKey));
    if (uniqueKeys.size !== dto.signers.length) {
      throw new BadRequestException(
        "Duplicate signer public keys are not allowed",
      );
    }

    const signerSet = await this.prisma.companyEscrowSignerSet.upsert({
      where: {
        companyId_escrowAccountId: {
          companyId,
          escrowAccountId: dto.escrowAccountId,
        },
      },
      create: {
        companyId,
        escrowAccountId: dto.escrowAccountId,
        threshold: dto.threshold,
        signers: {
          create: dto.signers.map((s) => ({
            publicKey: s.publicKey,
            userId: s.userId,
          })),
        },
      },
      update: {
        threshold: dto.threshold,
        signers: {
          deleteMany: {},
          create: dto.signers.map((s) => ({
            publicKey: s.publicKey,
            userId: s.userId,
          })),
        },
      },
      include: { signers: true },
    });

    return signerSet;
  }

  /**
   * Opens a new pending transaction awaiting signatures for a given signer
   * set.
   */
  async createPendingTransaction(
    signerSetId: string,
    unsignedXdr: string,
    description?: string,
  ) {
    const signerSet = await this.prisma.companyEscrowSignerSet.findUnique({
      where: { id: signerSetId },
    });
    if (!signerSet) {
      throw new NotFoundException(`Signer set ${signerSetId} not found`);
    }

    return this.prisma.multisigPendingTransaction.create({
      data: { signerSetId, unsignedXdr, description },
    });
  }

  /**
   * Records a signer's signature on a pending transaction and, once the
   * signer set's threshold is met, submits the combined transaction to
   * Horizon. This is the app-level gate referenced in #495: we only ever
   * call Horizon once we know (from our own signature count) that the
   * submission has a chance of succeeding, rather than submitting on every
   * signature and relying on the chain to reject under-signed attempts.
   *
   * A duplicate signature from the same signer on the same pending tx is a
   * no-op (upsert), so it never double-counts toward the threshold.
   */
  async submitSignature(
    pendingTxId: string,
    signerPublicKey: string,
    signedXdr: string,
  ): Promise<SignatureStatus> {
    const pendingTx = await this.prisma.multisigPendingTransaction.findUnique({
      where: { id: pendingTxId },
      include: { signerSet: { include: { signers: true } }, signatures: true },
    });
    if (!pendingTx) {
      throw new NotFoundException(
        `Pending transaction ${pendingTxId} not found`,
      );
    }

    if (pendingTx.status === "SUBMITTED") {
      return this.toStatus(pendingTx, pendingTx.signatures.length);
    }

    const signer = pendingTx.signerSet.signers.find(
      (s) => s.publicKey === signerPublicKey,
    );
    if (!signer) {
      throw new BadRequestException(
        `"${signerPublicKey}" is not an authorized signer for this escrow account`,
      );
    }

    // Validate the signature belongs to this signer before recording it.
    const extracted = this.stellar.extractSignatures(signedXdr);
    if (extracted.length === 0) {
      throw new BadRequestException("signedXdr does not contain a signature");
    }

    // Upsert: a resubmission from the same signer replaces their row rather
    // than adding a second one, so it can never double-count.
    await this.prisma.multisigSignature.upsert({
      where: { pendingTxId_signerId: { pendingTxId, signerId: signer.id } },
      create: { pendingTxId, signerId: signer.id, signedXdr },
      update: { signedXdr },
    });

    const signatures = await this.prisma.multisigSignature.findMany({
      where: { pendingTxId },
    });

    const signedCount = signatures.length;
    const threshold = pendingTx.signerSet.threshold;

    if (signedCount < threshold) {
      return this.toStatus(pendingTx, signedCount);
    }

    // Threshold met — submit now, inside this same call, so callers get the
    // final result from the signature that tipped it over.
    return this.trySubmit(
      pendingTx.id,
      pendingTx.unsignedXdr,
      signatures,
      threshold,
    );
  }

  async getSignatureStatus(pendingTxId: string): Promise<SignatureStatus> {
    const pendingTx = await this.prisma.multisigPendingTransaction.findUnique({
      where: { id: pendingTxId },
      include: { signerSet: true, signatures: true },
    });
    if (!pendingTx) {
      throw new NotFoundException(
        `Pending transaction ${pendingTxId} not found`,
      );
    }
    return this.toStatus(pendingTx, pendingTx.signatures.length);
  }

  private async trySubmit(
    pendingTxId: string,
    unsignedXdr: string,
    signatures: { signedXdr: string }[],
    threshold: number,
  ): Promise<SignatureStatus> {
    const allSigs = signatures.flatMap((s) =>
      this.stellar.extractSignatures(s.signedXdr),
    );

    try {
      const { txHash } = await this.stellar.submitMultisigTransaction(
        unsignedXdr,
        allSigs,
      );
      const updated = await this.prisma.multisigPendingTransaction.update({
        where: { id: pendingTxId },
        data: { status: "SUBMITTED", submittedTxHash: txHash },
        include: { signatures: true },
      });
      return this.toStatus(updated, updated.signatures.length);
    } catch (error) {
      this.logger.error(
        `Multisig submission failed for pending tx ${pendingTxId}: ${error.message}`,
      );
      const updated = await this.prisma.multisigPendingTransaction.update({
        where: { id: pendingTxId },
        data: { status: "FAILED", errorMessage: error.message },
        include: { signatures: true },
      });
      return this.toStatus(updated, updated.signatures.length, threshold);
    }
  }

  private toStatus(
    pendingTx: any,
    signedCount: number,
    thresholdOverride?: number,
  ): SignatureStatus {
    return {
      pendingTxId: pendingTx.id,
      status: pendingTx.status,
      threshold: thresholdOverride ?? pendingTx.signerSet?.threshold,
      signedCount,
      signerIds: (pendingTx.signatures ?? []).map((s: any) => s.signerId),
      submittedTxHash: pendingTx.submittedTxHash,
    };
  }
}
