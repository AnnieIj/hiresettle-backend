import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtKeyStore } from './jwt-key-store.service';

@Module({
  imports: [ConfigModule],
  providers: [JwtKeyStore],
  exports: [JwtKeyStore],
})
export class JwtKeysModule {}
