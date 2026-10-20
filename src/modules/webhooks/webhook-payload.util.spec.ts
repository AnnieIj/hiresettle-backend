import {
  buildWebhookRawBody,
  buildEngagementRefUrl,
} from "./webhook-payload.util";
import { WebhookPayload } from "./webhooks.service";

describe("buildWebhookRawBody", () => {
  const basePayload: WebhookPayload = {
    event: "COMPLETED",
    engagementId: "eng_123",
    status: "COMPLETED",
    timestamp: "2026-08-29T00:00:00.000Z",
  };

  it("sends the full payload unchanged when under the size cap", () => {
    const rawBody = buildWebhookRawBody(basePayload, 256 * 1024);
    expect(JSON.parse(rawBody)).toEqual(basePayload);
  });

  it("sends a compact reference form when the payload exceeds the cap", () => {
    const oversized = { ...basePayload, extra: "x".repeat(5000) } as any;
    const rawBody = buildWebhookRawBody(oversized, 1024);
    const parsed = JSON.parse(rawBody);

    expect(parsed.truncated).toBe(true);
    expect(parsed.extra).toBeUndefined();
    expect(parsed.event).toBe(basePayload.event);
    expect(parsed.engagementId).toBe(basePayload.engagementId);
    expect(parsed.ref).toBe(buildEngagementRefUrl(basePayload.engagementId));
    expect(Buffer.byteLength(rawBody, "utf8")).toBeLessThan(1024);
  });
});
