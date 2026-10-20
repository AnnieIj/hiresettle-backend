/**
 * Issue #494 — SEP-10 Stellar Web Authentication.
 *
 * SEP-10 lets a client wallet (e.g. Freighter) prove control of a Stellar
 * account without sharing a private key.  The flow is:
 *
 *  1. Client calls GET /auth?account=G…  → receives a challenge XDR.
 *  2. Client signs the challenge transaction with their key pair.
 *  3. Client calls POST /auth with the signed XDR  → receives a JWT.
 *
 * Reference: https://stellar.org/protocol/sep-10
 *
 * The existing nonce/challenge login flow is kept in parallel during the
 * transition period; SEP-10 is an additive endpoint.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Account,
  Memo,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class Sep10Service {
  private readonly logger = new Logger(Sep10Service.name);
  private readonly serverKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly homeDomain: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = this.config.get<string>('STELLAR_SECRET_KEY');
    if (!secret) throw new Error('STELLAR_SECRET_KEY is required for SEP-10');
    this.serverKeypair = Keypair.fromSecret(secret);

    this.networkPassphrase =
      this.config.get<string>('STELLAR_NETWORK') === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET;

    this.homeDomain = this.config.get<string>('APP_DOMAIN', 'hiresettle.com');
  }

  /**
   * Step 1 — Issue a SEP-10 challenge transaction.
   *
   * The transaction is never submitted to the network; it is only signed
   * by the client as proof of key ownership.
   */
  async createChallenge(account: string): Promise<{ transaction: string; network_passphrase: string }> {
    this.validateAccountId(account);

    const nonce = randomBytes(32).toString('base64');

    // Build a challenge transaction: sequence 0, expires in CHALLENGE_TTL_SECONDS.
    const serverAccount = new Account(this.serverKeypair.publicKey(), '-1');
    const now = Math.floor(Date.now() / 1000);

    const tx = new TransactionBuilder(serverAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
      timebounds: { minTime: now, maxTime: now + CHALLENGE_TTL_SECONDS },
    })
      .addOperation(
        Operation.manageData({
          name: `${this.homeDomain} auth`,
          value: nonce,
          source: account,
        }),
      )
      .addMemo(Memo.text('SEP-10 challenge'))
      .build();

    // Server signs first.
    tx.sign(this.serverKeypair);
    const xdr = tx.toXDR();

    const expiresAt = new Date((now + CHALLENGE_TTL_SECONDS) * 1000);
    await this.prisma.sep10Challenge.create({
      data: { account, nonce, xdr, expiresAt },
    });

    this.logger.log(`SEP-10 challenge issued for account=${account}`);
    return { transaction: xdr, network_passphrase: this.networkPassphrase };
  }

  /**
   * Step 2 — Verify the client-signed challenge transaction.
   *
   * Returns the verified Stellar account G-address.
   */
  async verifyChallenge(signedXdr: string): Promise<string> {
    let tx: Transaction;
    try {
      tx = new Transaction(signedXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid transaction XDR');
    }

    // Extract the nonce from the first manageData operation.
    const manageDataOp = tx.operations.find((op) => op.type === 'manageData') as
      | { type: 'manageData'; value: Buffer; source?: string }
      | undefined;

    if (!manageDataOp?.value) {
      throw new BadRequestException('Challenge transaction is missing manageData operation');
    }

    const nonce = manageDataOp.value.toString('base64');

    // Look up the pending challenge.
    const challenge = await this.prisma.sep10Challenge.findUnique({ where: { nonce } });
    if (!challenge) throw new UnauthorizedException('Challenge not found');
    if (challenge.usedAt) throw new UnauthorizedException('Challenge already used');
    if (challenge.expiresAt < new Date()) throw new UnauthorizedException('Challenge expired');

    // Verify the server signature is still present.
    const serverSignature = tx.signatures.find((sig) =>
      this.serverKeypair.verify(tx.hash(), sig.signature()),
    );
    if (!serverSignature) throw new UnauthorizedException('Server signature missing');

    // Verify the client account signed the transaction.
    const clientKeypair = Keypair.fromPublicKey(challenge.account);
    const clientSigned = tx.signatures.some((sig) => {
      try {
        return clientKeypair.verify(tx.hash(), sig.signature());
      } catch {
        return false;
      }
    });
    if (!clientSigned) throw new UnauthorizedException('Client signature invalid or missing');

    // Mark challenge as consumed.
    await this.prisma.sep10Challenge.update({
      where: { nonce },
      data: { usedAt: new Date() },
    });

    this.logger.log(`SEP-10 challenge verified for account=${challenge.account}`);
    return challenge.account;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private validateAccountId(account: string): void {
    try {
      Keypair.fromPublicKey(account);
    } catch {
      throw new BadRequestException(`Invalid Stellar account ID: ${account}`);
    }
  }
}
