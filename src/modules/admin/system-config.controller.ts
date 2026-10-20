import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemConfigService } from '../../common/system-config/system-config.service';
import { ResetSystemConfigDto, UpdateSystemConfigDto } from './dto/update-system-config.dto';

/**
 * Runtime system settings (#503). Changes are validated against the key's
 * definition, persisted, audit-logged (admin, key, old and new value) and take
 * effect immediately without a restart.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, AdminGuard)
@Controller('admin/system-config')
export class SystemConfigController {
  constructor(private readonly systemConfig: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List every runtime setting with its effective value and source (admin only)' })
  list() {
    return this.systemConfig.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a runtime setting (admin only)' })
  @ApiParam({ name: 'key', example: 'disputes.slaReviewHours' })
  @ApiResponse({ status: 404, description: 'Unknown key' })
  get(@Param('key') key: string) {
    return this.systemConfig.describe(key);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Update a runtime setting; applies immediately and is audit-logged (admin only)' })
  @ApiParam({ name: 'key', example: 'disputes.slaReviewHours' })
  @ApiResponse({ status: 400, description: 'Value has the wrong type or is out of bounds' })
  @ApiResponse({ status: 404, description: 'Unknown key' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.systemConfig.set(key, dto.value, adminId, dto.reason);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Remove the override so the env/default value applies again (admin only)' })
  @ApiParam({ name: 'key', example: 'disputes.slaReviewHours' })
  reset(
    @Param('key') key: string,
    @Body() dto: ResetSystemConfigDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.systemConfig.reset(key, adminId, dto.reason);
  }
}
