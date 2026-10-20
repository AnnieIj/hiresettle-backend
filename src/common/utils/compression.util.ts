import type { Request, Response } from "express";
import * as compression from "compression";

/**
 * Response compression (gzip/brotli via the `compression` middleware's
 * negotiated encoding) for all JSON/text responses, skipping Server-Sent
 * Events responses — buffering/compressing an SSE stream would break
 * streaming delivery to EventSource clients (#514).
 */
export function createCompressionMiddleware() {
  return compression({
    threshold: 1024,
    filter: (req: Request, res: Response) => {
      const contentType = res.getHeader("Content-Type");
      if (
        typeof contentType === "string" &&
        contentType.includes("text/event-stream")
      ) {
        return false;
      }
      return compression.filter(req, res);
    },
  });
}
