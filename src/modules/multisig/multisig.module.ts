import { Module } from "@nestjs/common";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { MultisigController } from "./multisig.controller";
import { MultisigService } from "./multisig.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MultisigController],
  providers: [MultisigService],
  exports: [MultisigService],
})
export class MultisigModule {}
