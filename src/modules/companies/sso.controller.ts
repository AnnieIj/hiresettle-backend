/**
 * Issue #489 — SAML/OIDC SSO endpoints for enterprise companies.
 *
 * PATCH  /companies/sso          → upsert IdP config (owner-only)
 * GET    /companies/sso          → read IdP config (owner-only)
 * GET    /auth/sso/oidc/:id      → redirect to IdP
 * GET    /auth/sso/oidc/:id/callback → handle IdP callback
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SsoService, UpsertSsoConfigDto } from './sso.service';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';

@ApiTags('sso')
@Controller()
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  /** Owner: configure the company's IdP. */
  @Patch('companies/sso')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upsert SSO / IdP configuration for your company' })
  async upsertConfig(@Req() req: any, @Body() dto: UpsertSsoConfigDto) {
    const companyId: string = req.user.id;
    return this.sso.upsertConfig(companyId, dto);
  }

  /** Owner: read back the company's IdP config. */
  @Get('companies/sso')
  @UseGuards(JwtOrApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get SSO / IdP configuration for your company' })
  async getConfig(@Req() req: any) {
    return this.sso.getConfig(req.user.id);
  }

  /** Redirect the browser to the IdP authorization endpoint. */
  @Get('auth/sso/oidc/:companyId')
  @Redirect()
  @ApiOperation({ summary: 'Initiate OIDC login for a company' })
  async initiateOidc(@Param('companyId') companyId: string, @Req() req: any) {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/sso/oidc/${companyId}/callback`;
    const url = await this.sso.buildAuthorizationUrl(companyId, redirectUri);
    return { url, statusCode: 302 };
  }

  /** Handle the OIDC authorization code callback. */
  @Get('auth/sso/oidc/:companyId/callback')
  @ApiOperation({ summary: 'OIDC callback — exchanges code for session' })
  async oidcCallback(
    @Param('companyId') companyId: string,
    @Query('code') code: string,
    @Req() req: any,
  ) {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/sso/oidc/${companyId}/callback`;
    const user = await this.sso.handleOidcCallback(companyId, code, redirectUri);
    // Return minimal user info; caller should issue a JWT via the auth service.
    return { userId: user.id, email: user.email };
  }
}
