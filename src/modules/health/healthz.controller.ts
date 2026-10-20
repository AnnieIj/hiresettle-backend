import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { QueueHealthIndicator } from './queue-health.indicator';

/**
 * Kubernetes probe endpoints (#510), served outside the API prefix.
 *
 *  - /healthz/live  — the process is up and the event loop responds. Never
 *    touches dependencies, so a database blip doesn't restart every pod.
 *  - /healthz/ready — the pod can serve traffic: Postgres and Redis are
 *    reachable. Returns 503 so the pod is taken out of the Service until it
 *    recovers. Stellar Horizon is deliberately excluded: it is external and
 *    has its own failover (see /health for the full report).
 */
@ApiTags('health')
@Controller('healthz')
export class HealthzController {
  constructor(
    private readonly healthService: HealthService,
    private readonly queueHealth: QueueHealthIndicator,
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe (database + Redis)' })
  async ready() {
    const results = await Promise.all([
      this.healthService.isDatabaseHealthy(),
      this.queueHealth.isHealthy(),
    ]);
    const checks = Object.assign({}, ...results) as Record<string, { status: string }>;
    const healthy = Object.values(checks).every((check) => check.status === 'up');

    if (!healthy) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ok', checks };
  }
}
