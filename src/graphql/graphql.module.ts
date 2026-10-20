import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { JwtService } from "@nestjs/jwt";
import { join } from "path";
import { GraphqlResolver } from "./graphql.resolver";
import { NotificationsResolver } from "./notifications.resolver";
import { EngagementFieldsResolver } from "./resolvers/engagement-fields.resolver";
import { authenticateConnection } from "./graphql-ws-auth";
import { createGraphqlLoaders, GraphqlContext } from "./loaders/graphql-loaders";
import { PrismaModule } from "../common/prisma/prisma.module";
import { PrismaService } from "../common/prisma/prisma.service";
import { NotificationsModule } from "../modules/notifications/notifications.module";
import { JwtKeysModule } from "../modules/auth/jwt-keys/jwt-keys.module";
import { JwtKeyStore } from "../modules/auth/jwt-keys/jwt-key-store.service";

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [PrismaModule, JwtKeysModule],
      inject: [JwtKeyStore, PrismaService],
      useFactory: (keyStore: JwtKeyStore, prisma: PrismaService) => {
        // Same keys and algorithms as REST, including rotated kids (#481).
        const jwt = new JwtService(keyStore.jwtModuleOptions());
        return {
          // Keep the schema in memory in production: containers run with a
          // read-only root filesystem (#510).
          autoSchemaFile:
            process.env.NODE_ENV === "production"
              ? true
              : join(process.cwd(), "src/graphql/schema.gql"),
          sortSchema: true,
          playground: false,
          // WebSocket subscriptions (#408), authenticated with the same JWT
          // as REST, passed via connectionParams.authorization.
          subscriptions: {
            "graphql-ws": {
              path: "/graphql",
              onConnect: async (ctx: any) => {
                const user = await authenticateConnection(jwt, ctx.connectionParams);
                if (!user) return false; // closes the socket with 4403 Forbidden
                ctx.extra.user = user;
                return true;
              },
            },
          },
          // Fresh DataLoaders per operation so batching/caching never leaks
          // across requests or users (#515).
          context: ({ req, extra }: { req?: any; extra?: any }): GraphqlContext => {
            const loaders = createGraphqlLoaders(prisma);
            return extra ? { user: extra.user, loaders } : { req, loaders };
          },
        };
      },
    }),
  ],
  providers: [GraphqlResolver, EngagementFieldsResolver, NotificationsResolver],
})
export class GraphqlModule {}
