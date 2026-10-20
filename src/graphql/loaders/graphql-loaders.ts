import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { GraphqlMilestone, GraphqlUser } from "../graphql.types";
import { alignByKey, BatchLoader, groupByKey } from "./batch-loader";

/** Public user fields exposed over GraphQL. */
export const userSelect = {
  id: true,
  stellarAddress: true,
  name: true,
  company: true,
  role: true,
  verifiedAt: true,
} satisfies Prisma.UserSelect;

/** Upper bound for a single `IN (...)` lookup. */
const MAX_BATCH_SIZE = 500;

export interface GraphqlLoaders {
  /** Users (recruiters, arbiters, …) keyed by Stellar address. */
  users: BatchLoader<string, GraphqlUser | null>;
  /** Company accounts keyed by Stellar address (engagement.companyAddress). */
  companies: BatchLoader<string, GraphqlUser | null>;
  /** Milestones of an engagement, ordered by milestoneIndex. */
  milestonesByEngagement: BatchLoader<string, GraphqlMilestone[]>;
}

export interface GraphqlContext {
  req?: any;
  user?: any;
  loaders: GraphqlLoaders;
}

export function serializeMilestone(milestone: any): GraphqlMilestone {
  return {
    ...milestone,
    amount: milestone.amount?.toString() ?? null,
  } as GraphqlMilestone;
}

function usersByStellarAddress(prisma: PrismaService) {
  return async (addresses: readonly string[]) => {
    const rows = await prisma.user.findMany({
      where: { stellarAddress: { in: [...addresses] } },
      select: userSelect,
    });
    return alignByKey(addresses, rows, (row) => row.stellarAddress);
  };
}

/**
 * Build a fresh set of loaders for one GraphQL operation (#515). Created in
 * the GraphQL context factory, so batching and caching are scoped to a single
 * request: listing N engagements costs one query per relation instead of N.
 */
export function createGraphqlLoaders(prisma: PrismaService): GraphqlLoaders {
  const options = { maxBatchSize: MAX_BATCH_SIZE };

  return {
    users: new BatchLoader(usersByStellarAddress(prisma), options),
    companies: new BatchLoader(usersByStellarAddress(prisma), options),
    milestonesByEngagement: new BatchLoader(async (engagementIds: readonly string[]) => {
      const rows = await prisma.milestone.findMany({
        where: { engagementId: { in: [...engagementIds] } },
        orderBy: [{ engagementId: "asc" }, { milestoneIndex: "asc" }],
      });
      return groupByKey(engagementIds, rows, (row) => row.engagementId).map((group) =>
        group.map(serializeMilestone),
      );
    }, options),
  };
}
