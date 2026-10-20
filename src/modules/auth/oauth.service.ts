import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecurityEventsService } from '../../common/security-events/security-events.service';
import { SessionService } from './session.service';
import { RequestMeta } from './auth.service';

// String literal — SecurityEventAction enum may not resolve in Jest mock env
const ACTION_LOGIN_SUCCESS = 'LOGIN_SUCCESS' as const;
const ACTION_LOGIN_FAILURE = 'LOGIN_FAILURE' as const;

/**
 * OAuthService — Google OAuth2 login via authorization-code flow (#444).
 *
 * Handles: getGoogleAuthUrl, exchangeGoogleCode, loginWithGoogle.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly securityEvents: SecurityEventsService,
    private readonly sessionService: SessionService,
  ) {}

  /** Build the Google OAuth2 authorization URL. */
  getGoogleAuthUrl(state: string): string {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL');
    if (!clientId || !callbackUrl) {
      throw new BadRequestException('Google OAuth is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      include_granted_scopes: 'true',
      state,
      prompt: 'select_account',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /** Exchange an authorization code for Google profile info. */
  async exchangeGoogleCode(code: string): Promise<{
    googleId: string;
    email: string;
    name?: string | null;
  }> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL');
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new BadRequestException('Google OAuth is not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      this.logger.warn(`Google token exchange failed: ${tokenRes.status}`);
      throw new UnauthorizedException('Google OAuth token exchange failed');
    }

    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new UnauthorizedException('Google OAuth token exchange failed');
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    if (!profileRes.ok) {
      throw new UnauthorizedException('Failed to fetch Google user profile');
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    if (!profile.sub || !profile.email) {
      throw new UnauthorizedException('Google account did not return a verified email');
    }

    if (profile.email_verified === false) {
      throw new UnauthorizedException('Google email is not verified');
    }

    return { googleId: profile.sub, email: profile.email, name: profile.name ?? null };
  }

  /**
   * Find-or-create a user from a Google profile, then issue a JWT pair.
   * Links to an existing account by email when no googleId match is found.
   */
  async loginWithGoogle(
    profile: { googleId: string; email: string; name?: string | null },
    meta: RequestMeta = {},
  ) {
    const email = profile.email.toLowerCase();
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.googleId }, { email }] },
    });

    if (user) {
      if (user.deactivatedAt || user.deletedAt) {
        await this.securityEvents.log({
          userId: user.id,
          action: ACTION_LOGIN_FAILURE,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        throw new ForbiddenException('Your account has been deactivated. Please contact an administrator.');
      }

      if (!user.googleId || (user.googleId !== profile.googleId && user.email === email)) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.googleId },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          googleId: profile.googleId,
          name: profile.name ?? undefined,
          role: 'COMPANY',
        },
      });
      this.logger.log(`User registered via Google OAuth: ${email}`);
    }

    // Reset failed attempts and log success
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.securityEvents.log({
      userId: user.id,
      action: ACTION_LOGIN_SUCCESS,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const tokens = await this.sessionService.issueTokenPair(user);
    const { passwordHash, webhookSecret, ...safeUser } = user as any;
    return { ...tokens, user: safeUser };
  }
}
