import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';

@Module({
  controllers: [CompaniesController, SsoController],
  providers: [CompaniesService, SsoService],
  exports: [CompaniesService, SsoService],
})
export class CompaniesModule {}
