import { WebhookPayload } from "./webhooks.service";

/**
 * Default cap (bytes) on the serialized outgoing webhook body before we
 * replace it with a compact reference form. Configurable via
 * WEBHOOK_MAX_PAYLOAD_BYTES (#492).
 */
export const DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES = 256 * 1024;

export function getWebhookMaxPayloadBytes(): number {
  const raw = process.env.WEBHOOK_MAX_PAYLOAD_BYTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WEBHOOK_MAX_PAYLOAD_BYTES;
}

/** Base URL used to build reference links back to the full resource. */
export function getAppBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    "https://api.hiresettle.com"
  );
}

export function buildEngagementRefUrl(engagementId: string): string {
  return `${getAppBaseUrl().replace(/\/$/, "")}/engagements/${engagementId}`;
}

/**
 * Serializes a webhook payload for delivery, enforcing a maximum body size.
 * When the full JSON-serialized payload would exceed `maxBytes`, a compact
 * reference form is sent instead, pointing the receiver at the full
 * resource via `ref` rather than inlining the (oversized) data.
 */
export function buildWebhookRawBody(
  payload: WebhookPayload & Record<string, unknown>,
  maxBytes: number = getWebhookMaxPayloadBytes(),
): string {
  const full = JSON.stringify(payload);
  if (Buffer.byteLength(full, "utf8") <= maxBytes) {
    return full;
  }

  const reference = {
    event: payload.event,
    engagementId: payload.engagementId,
    status: payload.status,
    timestamp: payload.timestamp,
    truncated: true,
    ref: buildEngagementRefUrl(payload.engagementId),
  };
  return JSON.stringify(reference);
}
