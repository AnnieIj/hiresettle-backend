import { Test } from "@nestjs/testing";
import { MultisigService } from "./multisig.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { StellarService } from "../../common/stellar/stellar.service";

describe("MultisigService", () => {
  let service: MultisigService;
  let prisma: any;
  let stellar: any;

  const signerSetId = "ss-1";
  const pendingTxId = "tx-1";
  const unsignedXdr = "UNSIGNED_XDR";

  const signerA = { id: "signer-a", publicKey: "GA_A", signerSetId };
  const signerB = { id: "signer-b", publicKey: "GA_B", signerSetId };
  const signerC = { id: "signer-c", publicKey: "GA_C", signerSetId };

  const makePendingTx = (overrides: any = {}) => ({
    id: pendingTxId,
    signerSetId,
    unsignedXdr,
    status: "PENDING",
    submittedTxHash: null,
    signerSet: {
      id: signerSetId,
      threshold: 2,
      signers: [signerA, signerB, signerC],
    },
    signatures: [],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      companyEscrowSignerSet: { findUnique: jest.fn(), upsert: jest.fn() },
      multisigPendingTransaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      multisigSignature: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
    };

    stellar = {
      extractSignatures: jest.fn().mockReturnValue(["sig"]),
      submitMultisigTransaction: jest
        .fn()
        .mockResolvedValue({ txHash: "HASH123" }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MultisigService,
        { provide: PrismaService, useValue: prisma },
        { provide: StellarService, useValue: stellar },
      ],
    }).compile();

    service = moduleRef.get(MultisigService);
  });

  it("does NOT submit to Horizon while below the signature threshold", async () => {
    const pendingTx = makePendingTx();
    prisma.multisigPendingTransaction.findUnique.mockResolvedValue(pendingTx);
    prisma.multisigSignature.upsert.mockResolvedValue({});
    prisma.multisigSignature.findMany.mockResolvedValue([
      { signerId: signerA.id, signedXdr: "x" },
    ]);

    const result = await service.submitSignature(
      pendingTxId,
      signerA.publicKey,
      "SIGNED_BY_A",
    );

    expect(stellar.submitMultisigTransaction).not.toHaveBeenCalled();
    expect(result.status).toBe("PENDING");
    expect(result.signedCount).toBe(1);
    expect(result.threshold).toBe(2);
  });

  it("submits to Horizon once the threshold is met", async () => {
    const pendingTx = makePendingTx();
    prisma.multisigPendingTransaction.findUnique.mockResolvedValue(pendingTx);
    prisma.multisigSignature.upsert.mockResolvedValue({});
    prisma.multisigSignature.findMany.mockResolvedValue([
      { signerId: signerA.id, signedXdr: "SIGNED_BY_A" },
      { signerId: signerB.id, signedXdr: "SIGNED_BY_B" },
    ]);
    prisma.multisigPendingTransaction.update.mockResolvedValue({
      ...pendingTx,
      status: "SUBMITTED",
      submittedTxHash: "HASH123",
      signatures: [{ signerId: signerA.id }, { signerId: signerB.id }],
    });

    const result = await service.submitSignature(
      pendingTxId,
      signerB.publicKey,
      "SIGNED_BY_B",
    );

    expect(stellar.submitMultisigTransaction).toHaveBeenCalledTimes(1);
    expect(stellar.submitMultisigTransaction).toHaveBeenCalledWith(
      unsignedXdr,
      ["sig", "sig"],
    );
    expect(result.status).toBe("SUBMITTED");
    expect(result.submittedTxHash).toBe("HASH123");
    expect(prisma.multisigPendingTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: pendingTxId },
        data: { status: "SUBMITTED", submittedTxHash: "HASH123" },
      }),
    );
  });

  it("does not double-count a duplicate signature from the same signer", async () => {
    const pendingTx = makePendingTx();
    prisma.multisigPendingTransaction.findUnique.mockResolvedValue(pendingTx);
    prisma.multisigSignature.upsert.mockResolvedValue({});
    // The DB enforces uniqueness on [pendingTxId, signerId]; findMany always
    // reflects distinct signers regardless of how many times one resubmits.
    prisma.multisigSignature.findMany.mockResolvedValue([
      { signerId: signerA.id, signedXdr: "SIGNED_BY_A_v2" },
    ]);

    await service.submitSignature(
      pendingTxId,
      signerA.publicKey,
      "SIGNED_BY_A",
    );
    const result = await service.submitSignature(
      pendingTxId,
      signerA.publicKey,
      "SIGNED_BY_A_v2",
    );

    expect(prisma.multisigSignature.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.multisigSignature.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { pendingTxId_signerId: { pendingTxId, signerId: signerA.id } },
      }),
    );
    expect(result.signedCount).toBe(1);
    expect(stellar.submitMultisigTransaction).not.toHaveBeenCalled();
  });

  it("rejects a signature from a public key that is not an authorized signer", async () => {
    const pendingTx = makePendingTx();
    prisma.multisigPendingTransaction.findUnique.mockResolvedValue(pendingTx);

    await expect(
      service.submitSignature(pendingTxId, "GA_UNKNOWN", "SIGNED"),
    ).rejects.toThrow(/not an authorized signer/);
    expect(prisma.multisigSignature.upsert).not.toHaveBeenCalled();
  });
});
