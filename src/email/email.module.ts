import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { BounceService } from './bounce.service';
import { BounceController } from './bounce.controller';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BounceController],
  providers: [BounceService, EmailService],
  exports: [EmailService, BounceService],
})
export class EmailModule {}
