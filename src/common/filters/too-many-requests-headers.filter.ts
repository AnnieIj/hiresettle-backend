import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Request, Response } from "express";

/**
 * Ensures ThrottlerException responses include standard rate-limit headers.
 *
 * Headers included:
 * - Retry-After: Seconds until rate limit resets
 * - X-RateLimit-Limit: Maximum requests allowed in the time window
 * - X-RateLimit-Remaining: Number of requests remaining (0 when throttled)
 * - X-RateLimit-Reset: Unix timestamp when the rate limit resets
 */
@Catch(ThrottlerException)
export class TooManyRequestsHeadersFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost) {
    if (host.getType() !== "http") return exception;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Extract throttler context from the exception if available
    const context = (exception as any).context;
    const ttl = context?.ttl ?? 60000; // default 60 seconds in ms
    const limit = context?.limit ?? 100; // default limit
    const ttlSeconds = Math.ceil(ttl / 1000);

    // Set standard rate-limit headers
    if (!response.getHeader("Retry-After")) {
      response.setHeader("Retry-After", String(ttlSeconds));
    }

    if (!response.getHeader("X-RateLimit-Limit")) {
      response.setHeader("X-RateLimit-Limit", String(limit));
    }

    if (!response.getHeader("X-RateLimit-Remaining")) {
      response.setHeader("X-RateLimit-Remaining", "0");
    }

    if (!response.getHeader("X-RateLimit-Reset")) {
      const resetAt = Math.floor(Date.now() / 1000) + ttlSeconds; // unix seconds
      response.setHeader("X-RateLimit-Reset", String(resetAt));
    }

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      success: false,
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: exception.getResponse(),
    });
  }
}
