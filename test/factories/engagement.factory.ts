import { Engagement, EngagementStatus } from '@prisma/client';
import { v4 as uuid } from 'uuid';

type EngagementOverrides = Partial<Engagement>;

export function buildEngagement(overrides: EngagementOverrides = {}): Engagement {
  const id = overrides.id ?? uuid();
  return {
    id,
    companyAddress: overrides.companyAddress ?? 'GCOMPANY000000000000000000000000000000000000000000000000',
    recruiterAddress: overrides.recruiterAddress ?? 'GRECRUITER0000000000000000000000000000000000000000000000',
    arbiterAddress: overrides.arbiterAddress ?? 'GARBITER000000000000000000000000000000000000000000000000',
    companyId: overrides.companyId ?? null,
    recruiterId: overrides.recruiterId ?? null,
    arbiterId: overrides.arbiterId ?? null,
    clientId: overrides.clientId ?? null,
    freelancerId: overrides.freelancerId ?? null,
    tokenAddress: overrides.tokenAddress ?? 'NATIVE',
    totalAmount: overrides.totalAmount ?? BigInt(100_000_000),
    releasedAmount: overrides.releasedAmount ?? BigInt(0),
    fundingShortfall: overrides.fundingShortfall ?? false,
    escrowBalance: overrides.escrowBalance ?? null,
    jobTitle: overrides.jobTitle ?? 'Senior Engineer',
    jobDescription: overrides.jobDescription ?? null,
    salaryRange: overrides.salaryRange ?? null,
    location: overrides.location ?? null,
    status: overrides.status ?? EngagementStatus.ACTIVE,
    replacementReason: overrides.replacementReason ?? null,
    txHash: overrides.txHash ?? null,
    createdLedger: overrides.createdLedger ?? null,
    templateVersionId: overrides.templateVersionId ?? null,
    tags: overrides.tags ?? [],
    archivedAt: overrides.archivedAt ?? null,
    requiredApprovals: overrides.requiredApprovals ?? 1,
    candidateName: overrides.candidateName ?? null,
    candidateEmail: overrides.candidateEmail ?? null,
    candidatePhone: overrides.candidatePhone ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as unknown as Engagement;
}
