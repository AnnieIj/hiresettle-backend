import { Milestone, MilestoneKind } from '@prisma/client';
import { v4 as uuid } from 'uuid';

type MilestoneOverrides = Partial<Milestone>;

export function buildMilestone(overrides: MilestoneOverrides = {}): Milestone {
  const id = overrides.id ?? uuid();
  return {
    id,
    engagementId: overrides.engagementId ?? uuid(),
    milestoneIndex: overrides.milestoneIndex ?? 0,
    name: overrides.name ?? 'Placement',
    kind: overrides.kind ?? MilestoneKind.PLACEMENT,
    paymentPercent: overrides.paymentPercent ?? 50,
    amount: overrides.amount ?? BigInt(50_000_000),
    retentionDays: overrides.retentionDays ?? null,
    validAfterLedger: overrides.validAfterLedger ?? null,
    unlockEstimatedAt: overrides.unlockEstimatedAt ?? null,
    proofHash: overrides.proofHash ?? null,
    disputeReason: overrides.disputeReason ?? null,
    approachingNotificationSent: overrides.approachingNotificationSent ?? false,
    placementDueAt: overrides.placementDueAt ?? null,
    reminderSent: overrides.reminderSent ?? false,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as unknown as Milestone;
}
