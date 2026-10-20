/**
 * Issue #478 — SNS webhook receiver for SES bounce/complaint notifications
 * and admin endpoints for managing the suppressed-email list.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BounceService, SnsNotification } from './bounce.service';
import { JwtOrApiKeyGuard } from '../common/guards/jwt-or-api-key.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('email-bounce')
@Controller()
export class BounceController {
  constructor(private readonly bounceService: BounceService) {}

  /**
   * POST /webhooks/ses-bounce
   *
   * Endpoint registered in AWS SNS as the subscription URL.
   * SES publishes bounce and complaint events here via SNS HTTP delivery.
   */
  @Post('webhooks/ses-bounce')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive SNS/SES bounce and complaint notifications' })
  async handleSesBounce(@Body() payload: SnsNotification) {
    // SNS sends a SubscriptionConfirmation on first setup — no action needed; 200 is enough.
    if (payload.Type === 'SubscriptionConfirmation') {
      return { status: 'confirmed' };
    }
    await this.bounceService.handleSnsNotification(payload);
    return { status: 'ok' };
  }

  /**
   * GET /admin/suppressed-emails
   * Admin-only: list all suppressed email addresses.
   */
  @Get('admin/suppressed-emails')
  @UseGuards(JwtOrApiKeyGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List suppressed email addresses' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async listSuppressed(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.bounceService.listSuppressed(
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 50,
    );
  }

  /**
   * DELETE /admin/suppressed-emails/:email
   * Admin-only: remove an address from the suppression list.
   */
  @Delete('admin/suppressed-emails/:email')
  @UseGuards(JwtOrApiKeyGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an email address from the suppression list' })
  async removeSuppressed(@Param('email') email: string) {
    return this.bounceService.removeSuppressed(email);
  }
}
