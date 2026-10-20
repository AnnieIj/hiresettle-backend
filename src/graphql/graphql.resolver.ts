import { Args, Context, Int, Query, Resolver } from "@nestjs/graphql";
import { EngagementStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  GraphqlEngagement,
  GraphqlMilestone,
  GraphqlUser,
} from "./graphql.types";
import {
  GraphqlContext,
  serializeMilestone,
  userSelect,
} from "./loaders/graphql-loaders";

/**
 * Scalar engagement columns only — company/recruiter/arbiter/milestones are
 * resolved through request-scoped DataLoaders (#515), see
 * EngagementFieldsResolver.
 */
function serializeEngagement(engagement: any): GraphqlEngagement {
  return {
    ...engagement,
    totalAmount: engagement.totalAmount.toString(),
    releasedAmount: engagement.releasedAmount.toString(),
  } as GraphqlEngagement;
}

@Resolver()
export class GraphqlResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [GraphqlUser])
  users(): Promise<GraphqlUser[]> {
    return this.prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  @Query(() => GraphqlUser, { nullable: true })
  user(
    @Args("stellarAddress") stellarAddress: string,
    @Context() ctx: GraphqlContext,
  ): Promise<GraphqlUser | null> {
    return ctx.loaders.users.load(stellarAddress);
  }

  @Query(() => [GraphqlEngagement])
  async engagements(
    @Args("status", { type: () => EngagementStatus, nullable: true })
    status?: EngagementStatus,
    @Args("skip", { type: () => Int, nullable: true, defaultValue: 0 })
    skip = 0,
    @Args("take", { type: () => Int, nullable: true, defaultValue: 20 })
    take = 20,
  ): Promise<GraphqlEngagement[]> {
    const engagements = await this.prisma.engagement.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
    return engagements.map(serializeEngagement);
  }

  @Query(() => GraphqlEngagement, { nullable: true })
  async engagement(@Args("id") id: string): Promise<GraphqlEngagement | null> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id },
    });
    if (!engagement) return null;
    return serializeEngagement(engagement);
  }

  @Query(() => [GraphqlMilestone])
  async milestones(
    @Args("engagementId", { nullable: true }) engagementId?: string,
  ): Promise<GraphqlMilestone[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: engagementId ? { engagementId } : undefined,
      orderBy: [{ engagementId: "asc" }, { milestoneIndex: "asc" }],
    });
    return milestones.map(serializeMilestone);
  }
}
