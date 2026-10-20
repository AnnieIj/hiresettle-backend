import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as Sentry from '@sentry/node';
import { JwtKeyStore } from './jwt-keys/jwt-key-store.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(keyStore: JwtKeyStore) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Resolve the key from the token's alg/kid so tokens signed by a
      // rotated-out (but still listed) key stay valid until expiry (#481).
      algorithms: keyStore.verifyAlgorithms(),
      secretOrKeyProvider: (_req: unknown, rawJwtToken: string, done: (err: any, key?: any) => void) => {
        try {
          done(null, keyStore.verificationKeyFor(rawJwtToken));
        } catch (err) {
          done(err);
        }
      },
    });
  }

  async validate(payload: any) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = {
      id: payload.sub,
      email: payload.email,
      stellarAddress: payload.stellarAddress,
      role: payload.role,
      impersonated: payload.impersonated === true,
      impersonatorId: payload.impersonatorId,
    };

    Sentry.setUser({ id: user.id, email: user.email, username: user.role });

    return user;
  }
}
