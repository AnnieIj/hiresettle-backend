import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { RemoveScheduledJobDto } from './dto/remove-scheduled-job.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtOrApiKeyGuard, AdminGuard)
@Controller('admin/jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('scheduled')
  @ApiOperation({
    summary:
      'List BullMQ job schedulers (repeatable) and delayed jobs, plus named in-process cron jobs, intervals and timeouts (admin only)',
  })
  listScheduled() {
    return this.jobs.listScheduled();
  }

  @Delete('scheduled/:jobKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remove a scheduled job; audit-logged. In-process cron/interval/timeout removal affects this instance until restart (admin only)',
  })
  @ApiParam({ name: 'jobKey', description: 'jobKey from the listing, URL-encoded', example: 'bullmq-scheduler:email:digest' })
  @ApiResponse({ status: 400, description: 'Malformed job key' })
  @ApiResponse({ status: 404, description: 'No such scheduled job' })
  removeScheduled(
    @Param('jobKey') jobKey: string,
    @Body() dto: RemoveScheduledJobDto,
    @CurrentUser('id') adminId: string,
  ) {
    return this.jobs.removeScheduled(jobKey, adminId, dto.reason);
  }
}
