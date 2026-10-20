/**
 * Issue #494 — SEP-10 Stellar Web Authentication endpoints.
 *
 * GET  /auth?account=G…        → challenge XDR
 * POST /auth                   → verify signed XDR, return JWT
 *
 * The existing wallet-nonce login flow remains untouched during transition.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Sep10Service } from './sep10.service';

export class Sep10VerifyDto {
  /** Base64-encoded signed challenge transaction XDR */
  transaction: string;
}

@ApiTags('sep10')
@Controller('auth')
export class Sep10Controller {
  constructor(private readonly sep10: Sep10Service) {}

  @Get()
  @ApiOperation({ summary: 'SEP-10: issue a challenge transaction for the given Stellar account' })
  @ApiQuery({ name: 'account', required: true, description: 'Stellar G-address' })
  async challenge(@Query('account') account: string) {
    return this.sep10.createChallenge(account);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'SEP-10: verify a signed challenge and return a session JWT' })
  async verify(@Body() dto: Sep10VerifyDto) {
    const stellarAccount = await this.sep10.verifyChallenge(dto.transaction);
    return { stellar_account: stellarAccount, verified: true };
  }
}
