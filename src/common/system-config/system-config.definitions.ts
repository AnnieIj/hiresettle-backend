/**
 * Runtime-tunable settings (#503). Only keys listed here can be read or
 * written through the admin SystemConfig API, so internal bookkeeping rows in
 * `system_config` (Horizon cursors, alert state, …) are never exposed.
 *
 * Resolution order for a value: admin override in `system_config` → the
 * environment variable `envKey` → `defaultValue`.
 */
export type SystemConfigType = 'integer' | 'boolean' | 'string' | 'stroops';

export type SystemConfigValue = number | boolean | string;

export interface SystemConfigDefinition {
  key: string;
  type: SystemConfigType;
  description: string;
  envKey?: string;
  defaultValue: SystemConfigValue;
  /** Inclusive bounds for integer / stroops values. */
  min?: number | string;
  max?: number | string;
  /** Allowed values for string settings. */
  allowed?: readonly string[];
  /** Max length for free-form string settings. */
  maxLength?: number;
}

export const SYSTEM_CONFIG_DEFINITIONS: readonly SystemConfigDefinition[] = [
  {
    key: 'disputes.slaAssignmentHours',
    type: 'integer',
    description: 'Hours an admin has to assign an arbiter before the dispute is escalated',
    envKey: 'DISPUTE_SLA_ASSIGNMENT_HOURS',
    defaultValue: 24,
    min: 1,
    max: 720,
  },
  {
    key: 'disputes.slaReviewHours',
    type: 'integer',
    description: 'Hours the arbiter has to decide a dispute',
    envKey: 'DISPUTE_SLA_REVIEW_HOURS',
    defaultValue: 72,
    min: 1,
    max: 720,
  },
  {
    key: 'disputes.slaAppealHours',
    type: 'integer',
    description: 'Hours the appeal arbiter has to decide an appeal',
    envKey: 'DISPUTE_SLA_APPEAL_HOURS',
    defaultValue: 72,
    min: 1,
    max: 720,
  },
  {
    key: 'disputes.appealWindowHours',
    type: 'integer',
    description: 'Hours after a decision during which either party may appeal (0 settles immediately)',
    envKey: 'DISPUTE_APPEAL_WINDOW_HOURS',
    defaultValue: 72,
    min: 0,
    max: 720,
  },
  {
    key: 'milestones.placementReminderDays',
    type: 'integer',
    description: 'Days before a PLACEMENT milestone due date to remind the recruiter (0 disables)',
    envKey: 'PLACEMENT_MILESTONE_REMINDER_DAYS',
    defaultValue: 7,
    min: 0,
    max: 365,
  },
  {
    key: 'stellar.balanceAlertThresholdStroops',
    type: 'stroops',
    description: 'Alert admins when the backend Stellar account balance drops below this many stroops',
    envKey: 'STELLAR_BALANCE_ALERT_THRESHOLD_STROOPS',
    defaultValue: '10000000',
    min: '0',
    max: '1000000000000000',
  },
];

export const SYSTEM_CONFIG_DEFINITION_MAP: ReadonlyMap<string, SystemConfigDefinition> = new Map(
  SYSTEM_CONFIG_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export class SystemConfigValidationError extends Error {}

/**
 * Strictly validate an incoming value for a setting: no coercion from
 * strings for numbers/booleans, bounds enforced, stroops as integer strings.
 */
export function validateSystemConfigValue(
  definition: SystemConfigDefinition,
  value: unknown,
): SystemConfigValue {
  switch (definition.type) {
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new SystemConfigValidationError(`${definition.key} must be an integer`);
      }
      if (definition.min !== undefined && value < Number(definition.min)) {
        throw new SystemConfigValidationError(`${definition.key} must be >= ${definition.min}`);
      }
      if (definition.max !== undefined && value > Number(definition.max)) {
        throw new SystemConfigValidationError(`${definition.key} must be <= ${definition.max}`);
      }
      return value;
    }
    case 'stroops': {
      const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
      if (typeof text !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(text)) {
        throw new SystemConfigValidationError(
          `${definition.key} must be a non-negative integer number of stroops (string)`,
        );
      }
      const amount = BigInt(text);
      if (definition.min !== undefined && amount < BigInt(definition.min)) {
        throw new SystemConfigValidationError(`${definition.key} must be >= ${definition.min}`);
      }
      if (definition.max !== undefined && amount > BigInt(definition.max)) {
        throw new SystemConfigValidationError(`${definition.key} must be <= ${definition.max}`);
      }
      return text;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new SystemConfigValidationError(`${definition.key} must be true or false`);
      }
      return value;
    }
    case 'string': {
      if (typeof value !== 'string') {
        throw new SystemConfigValidationError(`${definition.key} must be a string`);
      }
      if (definition.allowed && !definition.allowed.includes(value)) {
        throw new SystemConfigValidationError(
          `${definition.key} must be one of: ${definition.allowed.join(', ')}`,
        );
      }
      if (definition.maxLength !== undefined && value.length > definition.maxLength) {
        throw new SystemConfigValidationError(
          `${definition.key} must be at most ${definition.maxLength} characters`,
        );
      }
      return value;
    }
  }
}

/** Serialise a validated value for the `system_config.value` text column. */
export function serializeSystemConfigValue(value: SystemConfigValue): string {
  return String(value);
}

/**
 * Parse a stored or env string into the setting's type. Returns undefined
 * when the raw value is missing or invalid, so resolution falls through to
 * the next source instead of crashing a consumer.
 */
export function parseSystemConfigValue(
  definition: SystemConfigDefinition,
  raw: string | number | boolean | undefined | null,
): SystemConfigValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const text = String(raw).trim();
  let candidate: unknown = text;
  if (definition.type === 'integer') candidate = Number(text);
  if (definition.type === 'boolean') {
    candidate = ['true', '1', 'yes'].includes(text.toLowerCase())
      ? true
      : ['false', '0', 'no'].includes(text.toLowerCase())
        ? false
        : text;
  }
  try {
    return validateSystemConfigValue(definition, candidate);
  } catch {
    return undefined;
  }
}
