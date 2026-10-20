import { Context, Parent, ResolveField, Resolver } from "@nestjs/graphql";
import {
  GraphqlEngagement,
  GraphqlMilestone,
  GraphqlUser,
} from "../graphql.types";
import { GraphqlContext } from "../loaders/graphql-loaders";

/**
 * Relation fields of Engagement (#515). Each field goes through a
 * request-scoped DataLoader, so a page of N engagements issues one users,
 * one companies and one milestones query in total instead of 4×N.
 */
@Resolver(() => GraphqlEngagement)
export class EngagementFieldsResolver {
  @ResolveField(() => GraphqlUser)
  company(
    @Parent() engagement: GraphqlEngagement,
    @Context() ctx: GraphqlContext,
  ): Promise<GraphqlUser | null> {
    return ctx.loaders.companies.load(engagement.companyAddress);
  }

  @ResolveField(() => GraphqlUser)
  recruiter(
    @Parent() engagement: GraphqlEngagement,
    @Context() ctx: GraphqlContext,
  ): Promise<GraphqlUser | null> {
    return ctx.loaders.users.load(engagement.recruiterAddress);
  }

  @ResolveField(() => GraphqlUser)
  arbiter(
    @Parent() engagement: GraphqlEngagement,
    @Context() ctx: GraphqlContext,
  ): Promise<GraphqlUser | null> {
    return ctx.loaders.users.load(engagement.arbiterAddress);
  }

  @ResolveField(() => [GraphqlMilestone])
  milestones(
    @Parent() engagement: GraphqlEngagement,
    @Context() ctx: GraphqlContext,
  ): Promise<GraphqlMilestone[]> {
    return ctx.loaders.milestonesByEngagement.load(engagement.id);
  }
}
