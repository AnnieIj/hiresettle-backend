import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtKeyStore } from './jwt-key-store.service';

/** Seconds downstream verifiers may cache the key set. */
const JWKS_MAX_AGE_SECONDS = 300;

@ApiTags('auth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly keyStore: JwtKeyStore) {}

  /**
   * Public signing keys (RFC 7517) for services that verify HireSettle access
   * tokens (#481). Served outside the API prefix and the response envelope so
   * standard JWKS clients can consume it as-is.
   */
  @Get('jwks.json')
  @ApiOperation({ summary: 'JSON Web Key Set used to verify access tokens' })
  getJwks(@Res() res: Response) {
    res.setHeader('Cache-Control', `public, max-age=${JWKS_MAX_AGE_SECONDS}`);
    res.json(this.keyStore.jwks());
  }
}
