import { Dispute, DisputeStatus } from '@prisma/client';
import { v4 as uuid } from 'uuid';

type DisputeOverrides = Partial<Dispute>;

export function buildDispute(overrides: DisputeOverrides = {}): Dispute {
  const id = overrides.id ?? uuid();
  return {
    id,
    engagementId: overrides.engagementId ?? uuid(),
    milestoneId: overrides.milestoneId ?? uuid(),
    raisedById: overrides.raisedById ?? null,
    reason: overrides.reason ?? null,
    status: overrides.status ?? DisputeStatus.OPEN,
    stage: overrides.stage ?? ('ASSIGNMENT' as any),
    arbiterId: overrides.arbiterId ?? null,
    arbiterAssignedAt: overrides.arbiterAssignedAt ?? null,
    arbiterManuallyAssigned: overrides.arbiterManuallyAssigned ?? false,
    responseDeadline: overrides.responseDeadline ?? null,
    slaStatus: overrides.slaStatus ?? ('ON_TRACK' as any),
    slaEscalatedAt: overrides.slaEscalatedAt ?? null,
    outcome: overrides.outcome ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as unknown as Dispute;
}
