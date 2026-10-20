// auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SessionService } from './session.service';
import { WalletAuthService } from './wallet-auth.service';
import { OAuthService } from './oauth.service';
import { ApiKeysService } from './api-keys.service';
import { JwtStrategy } from './jwt.strategy';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { JwtOrApiKeyGuard } from '../../common/guards/jwt-or-api-key.guard';
import { ApiKeyScopesGuard } from '../../common/guards/api-key-scopes.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    SessionService,
    WalletAuthService,
    OAuthService,
    ApiKeysService,
    JwtStrategy,
    ApiKeyGuard,
    JwtOrApiKeyGuard,
    ApiKeyScopesGuard,
  ],
  exports: [
    AuthService,
    TwoFactorService,
    SessionService,
    WalletAuthService,
    OAuthService,
    ApiKeysService,
    ApiKeyGuard,
    JwtOrApiKeyGuard,
    ApiKeyScopesGuard,
  ],
})
export class AuthModule {}
