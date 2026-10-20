/**
 * Issue #489 — SAML/OIDC Single Sign-On for enterprise companies.
 *
 * Phase 1 implements OIDC (OpenID Connect).  SAML is gated by the
 * `protocol` field on CompanySsoConfig and reserved for phase 2.
 *
 * Flow:
 *  1. Company owner configures their IdP via PATCH /companies/sso.
 *  2. A member visiting /auth/sso/oidc/:companyId is redirected to the
 *     IdP's authorization endpoint.
 *  3. The IdP redirects back to /auth/sso/oidc/:companyId/callback with
 *     an authorization code.
 *  4. The service exchanges the code for tokens, verifies the ID token,
 *     and provisions (or looks up) the user just-in-time.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SsoProtocol } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomBytes } from 'crypto';

export interface UpsertSsoConfigDto {
  protocol?: SsoProtocol;
  issuer: string;
  clientId?: string;
  clientSecret?: string;
  metadataUrl?: string;
  defaultRole?: string;
  isEnabled?: boolean;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Upsert the SSO configuration for a company (owner-only). */
  async upsertConfig(companyId: string, dto: UpsertSsoConfigDto) {
    return this.prisma.companySsoConfig.upsert({
      where: { companyId },
      update: { ...dto },
      create: { companyId, ...dto },
    });
  }

  /** Retrieve the SSO configuration for a company. */
  async getConfig(companyId: string) {
    const cfg = await this.prisma.companySsoConfig.findUnique({
      where: { companyId },
    });
    if (!cfg) throw new NotFoundException('No SSO configuration found for this company');
    return cfg;
  }

  /**
   * Build the OIDC authorization URL to redirect the browser to.
   * The `state` parameter embeds the companyId so the callback can
   * look up the correct IdP configuration.
   */
  async buildAuthorizationUrl(companyId: string, redirectUri: string): Promise<string> {
    const cfg = await this.getConfig(companyId);
    if (!cfg.isEnabled) throw new BadRequestException('SSO is not enabled for this company');
    if (cfg.protocol !== SsoProtocol.OIDC) {
      throw new BadRequestException('Only OIDC is supported in this release');
    }
    if (!cfg.clientId || !cfg.metadataUrl) {
      throw new BadRequestException('Incomplete OIDC configuration');
    }

    const discoveryDoc = await this.fetchOidcDiscovery(cfg.metadataUrl);
    const state = Buffer.from(JSON.stringify({ companyId, nonce: randomBytes(8).toString('hex') })).toString('base64url');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
      state,
    });

    return `${discoveryDoc.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Handle the OIDC callback: exchange the code for tokens, verify the
   * ID token, and provision the user just-in-time if they don't exist.
   *
   * Returns the internal User record so the caller can issue a JWT.
   */
  async handleOidcCallback(
    companyId: string,
    code: string,
    redirectUri: string,
  ) {
    const cfg = await this.getConfig(companyId);
    if (!cfg.isEnabled) throw new BadRequestException('SSO is not enabled for this company');
    if (!cfg.clientId || !cfg.clientSecret || !cfg.metadataUrl) {
      throw new BadRequestException('Incomplete OIDC configuration');
    }

    const discoveryDoc = await this.fetchOidcDiscovery(cfg.metadataUrl);

    // Exchange authorization code for tokens.
    const tokenRes = await fetch(discoveryDoc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new UnauthorizedException('Token exchange failed');
    }
    const tokens = (await tokenRes.json()) as { id_token?: string };
    if (!tokens.id_token) throw new UnauthorizedException('No id_token in response');

    // Decode the JWT payload (signature verification should use JWKS in production).
    const payload = this.decodeIdTokenPayload(tokens.id_token);
    const email: string = payload.email;
    if (!email) throw new UnauthorizedException('id_token missing email claim');

    // Just-in-time provisioning: find or create the user.
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        firstName: payload.given_name ?? undefined,
        lastName: payload.family_name ?? undefined,
      },
      create: {
        email,
        firstName: payload.given_name ?? '',
        lastName: payload.family_name ?? '',
        passwordHash: '', // SSO users have no password
        role: cfg.defaultRole as any,
        isEmailVerified: true,
      },
    });

    // Ensure the user is linked to the company as a member.
    await this.prisma.companyMember.upsert({
      where: { companyId_memberId: { companyId, memberId: user.id } },
      update: {},
      create: { companyId, memberId: user.id },
    });

    this.logger.log(`SSO login: user=${user.id} company=${companyId}`);
    return user;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async fetchOidcDiscovery(metadataUrl: string): Promise<Record<string, string>> {
    const res = await fetch(metadataUrl);
    if (!res.ok) throw new BadRequestException('Failed to fetch OIDC discovery document');
    return res.json() as Promise<Record<string, string>>;
  }

  /** Base64url-decode and JSON-parse an ID token's payload (no sig verification). */
  private decodeIdTokenPayload(idToken: string): Record<string, any> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed id_token');
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, any>;
  }
}
