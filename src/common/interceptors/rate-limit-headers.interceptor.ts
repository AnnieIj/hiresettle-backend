import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';

/**
 * Adds rate-limit headers to all successful responses.
 * 
 * Headers added:
 * - X-RateLimit-Limit: Maximum requests allowed in the time window
 * - X-RateLimit-Remaining: Approximate remaining requests (note: actual tracking is in Redis)
 * - X-RateLimit-Reset: Unix timestamp when the rate limit resets
 * 
 * Note: X-RateLimit-Remaining is an approximation since actual tracking 
 * happens in the throttler guard with Redis. For exact remaining count,
 * the throttler would need to be modified to expose this information.
 */
@Injectable()
export class RateLimitHeadersInterceptor implements NestInterceptor {
  private readonly defaultLimit: number;
  private readonly defaultTtl: number;

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.defaultLimit = this.config?.get<number>('THROTTLE_LIMIT', 100) ?? 100;
    this.defaultTtl = this.config?.get<number>('THROTTLE_TTL', 60) ?? 60;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const response = context.switchToHttp().getResponse<Response>();

    // Get throttle metadata from the route handler
    const limit = this.reflector.get<number>(
      THROTTLER_LIMIT,
      context.getHandler(),
    ) ?? this.defaultLimit;

    const ttl = this.reflector.get<number>(
      THROTTLER_TTL,
      context.getHandler(),
    ) ?? this.defaultTtl;

    return next.handle().pipe(
      tap(() => {
        // Only add headers if not already set (e.g., by error filter)
        if (!response.headersSent && !response.getHeader('X-RateLimit-Limit')) {
          response.setHeader('X-RateLimit-Limit', String(limit));
          
          // Note: We don't have access to actual remaining count from throttler storage
          // This would require custom integration with the throttler guard
          // For now, we omit X-RateLimit-Remaining on success to avoid misleading values
          
          const resetAt = Math.floor(Date.now() / 1000) + ttl;
          response.setHeader('X-RateLimit-Reset', String(resetAt));
        }
      }),
    );
  }
}
