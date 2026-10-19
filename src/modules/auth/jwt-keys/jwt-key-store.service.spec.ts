import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'crypto';
import { decodeHeader, JwtKeyStore } from './jwt-key-store.service';
import { JwksController } from './jwks.controller';

const LEGACY_SECRET = 'a-very-long-legacy-hs256-secret-value-0123456789';

function makeKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function makeStore(values: Record<string, unknown>): JwtKeyStore {
  const config = { get: (key: string) => values[key] } as any;
  return new JwtKeyStore(config);
}

function makeJwt(store: JwtKeyStore): JwtService {
  return new JwtService(store.jwtModuleOptions('15m'));
}

describe('JwtKeyStore (#481)', () => {
  const previous = makeKeyPair();
  const current = makeKeyPair();

  describe('asymmetric signing', () => {
    it('signs access tokens with RS256 and the active kid', () => {
      const store = makeStore({
        JWT_SECRET: LEGACY_SECRET,
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'k-2026-10', privateKey: current.privateKey }]),
      });

      const token = makeJwt(store).sign({ sub: 'user-1', type: 'access' });

      expect(decodeHeader(token)).toMatchObject({ alg: 'RS256', kid: 'k-2026-10' });
      expect(store.isAsymmetric).toBe(true);
      expect(store.activeKid).toBe('k-2026-10');
      expect(makeJwt(store).verify(token)).toMatchObject({ sub: 'user-1', type: 'access' });
    });

    it('accepts PEMs with escaped newlines (env-var friendly)', () => {
      const escaped = current.privateKey.replace(/\n/g, '\\n');
      const store = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'k1', privateKey: escaped }]),
      });

      expect(store.activeKid).toBe('k1');
    });

    it('honours JWT_ACTIVE_KID when several keys have private keys', () => {
      const store = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([
          { kid: 'old', privateKey: previous.privateKey },
          { kid: 'new', privateKey: current.privateKey },
        ]),
        JWT_ACTIVE_KID: 'new',
      });

      expect(decodeHeader(makeJwt(store).sign({ sub: 'u' }))?.kid).toBe('new');
    });
  });

  describe('rotation with overlapping keys', () => {
    it('keeps accepting tokens signed by the predecessor key until it is removed', () => {
      const beforeRotation = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'old', privateKey: previous.privateKey }]),
      });
      const oldToken = makeJwt(beforeRotation).sign({ sub: 'user-1', type: 'access' });

      // Rotate: new key signs, old key is kept as verify-only.
      const afterRotation = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([
          { kid: 'new', privateKey: current.privateKey },
          { kid: 'old', publicKey: previous.publicKey },
        ]),
      });
      const jwt = makeJwt(afterRotation);

      expect(jwt.verify(oldToken)).toMatchObject({ sub: 'user-1' });
      const newToken = jwt.sign({ sub: 'user-2', type: 'access' });
      expect(decodeHeader(newToken)?.kid).toBe('new');
      expect(jwt.verify(newToken)).toMatchObject({ sub: 'user-2' });

      // Retire the old key: its tokens are now rejected.
      const retired = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'new', privateKey: current.privateKey }]),
      });
      expect(() => makeJwt(retired).verify(oldToken)).toThrow(/Unknown JWT key id/);
    });

    it('rejects a token whose kid is listed but whose signature came from another key', () => {
      const forger = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'new', privateKey: previous.privateKey }]),
      });
      const forged = makeJwt(forger).sign({ sub: 'attacker' });
      const store = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'new', privateKey: current.privateKey }]),
      });

      expect(() => makeJwt(store).verify(forged)).toThrow(/invalid signature/);
    });

    it('still honours token expiry for predecessor keys', () => {
      const before = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'old', privateKey: previous.privateKey }]),
      });
      const expired = makeJwt(before).sign(
        { sub: 'user-1', iat: Math.floor(Date.now() / 1000) - 3600 },
        { expiresIn: 60 },
      );
      const after = makeStore({
        JWT_SIGNING_KEYS: JSON.stringify([
          { kid: 'new', privateKey: current.privateKey },
          { kid: 'old', publicKey: previous.publicKey },
        ]),
      });

      expect(() => makeJwt(after).verify(expired)).toThrow(/jwt expired/);
    });
  });

  describe('legacy HS256 handling', () => {
    it('falls back to HS256 with JWT_SECRET when no keys are configured', () => {
      const store = makeStore({ JWT_SECRET: LEGACY_SECRET });
      const token = makeJwt(store).sign({ sub: 'user-1' });

      expect(store.isAsymmetric).toBe(false);
      expect(decodeHeader(token)).toMatchObject({ alg: 'HS256' });
      expect(decodeHeader(token)?.kid).toBeUndefined();
      expect(makeJwt(store).verify(token)).toMatchObject({ sub: 'user-1' });
      expect(store.jwks()).toEqual({ keys: [] });
    });

    it('rejects HS256 tokens after migration unless JWT_ACCEPT_LEGACY_HS256 is set', () => {
      const legacyToken = makeJwt(makeStore({ JWT_SECRET: LEGACY_SECRET })).sign({ sub: 'user-1' });
      const keys = JSON.stringify([{ kid: 'new', privateKey: current.privateKey }]);

      const strict = makeStore({ JWT_SECRET: LEGACY_SECRET, JWT_SIGNING_KEYS: keys });
      expect(() => makeJwt(strict).verify(legacyToken)).toThrow(/Unsupported JWT algorithm/);

      const migrating = makeStore({
        JWT_SECRET: LEGACY_SECRET,
        JWT_SIGNING_KEYS: keys,
        JWT_ACCEPT_LEGACY_HS256: 'true',
      });
      expect(makeJwt(migrating).verify(legacyToken)).toMatchObject({ sub: 'user-1' });
    });

    it('is not vulnerable to RS256→HS256 algorithm confusion', () => {
      const store = makeStore({
        JWT_SECRET: LEGACY_SECRET,
        JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'new', privateKey: current.privateKey }]),
        JWT_ACCEPT_LEGACY_HS256: 'true',
      });
      // HMAC-signed with the *public* key, which an attacker can fetch from the JWKS.
      const forged = new JwtService({ secret: current.publicKey }).sign(
        { sub: 'attacker' },
        { header: { alg: 'HS256', kid: 'new' } as any },
      );

      expect(() => makeJwt(store).verify(forged)).toThrow();
    });
  });

  describe('configuration validation', () => {
    it('throws on duplicate kids', () => {
      expect(() =>
        makeStore({
          JWT_SIGNING_KEYS: JSON.stringify([
            { kid: 'dup', privateKey: current.privateKey },
            { kid: 'dup', publicKey: previous.publicKey },
          ]),
        }),
      ).toThrow(/Duplicate/);
    });

    it('throws when no entry can sign', () => {
      expect(() =>
        makeStore({ JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'pub', publicKey: current.publicKey }]) }),
      ).toThrow(/privateKey/);
    });

    it('throws when JWT_ACTIVE_KID does not exist', () => {
      expect(() =>
        makeStore({
          JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'a', privateKey: current.privateKey }]),
          JWT_ACTIVE_KID: 'missing',
        }),
      ).toThrow(/does not match/);
    });

    it('rejects RSA keys shorter than 2048 bits', () => {
      const weak = generateKeyPairSync('rsa', {
        modulusLength: 1024,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      expect(() =>
        makeStore({ JWT_SIGNING_KEYS: JSON.stringify([{ kid: 'weak', privateKey: weak.privateKey }]) }),
      ).toThrow(/at least 2048 bits/);
    });
  });

  describe('JWKS', () => {
    const store = makeStore({
      JWT_SIGNING_KEYS: JSON.stringify([
        { kid: 'new', privateKey: current.privateKey },
        { kid: 'old', publicKey: previous.publicKey },
      ]),
    });

    it('publishes every trusted public key with RFC 7517 fields', () => {
      const { keys } = store.jwks();

      expect(keys.map((k) => k.kid)).toEqual(['new', 'old']);
      for (const key of keys) {
        expect(key).toEqual({
          kty: 'RSA',
          kid: expect.any(String),
          use: 'sig',
          alg: 'RS256',
          n: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
          e: 'AQAB',
        });
        expect(key).not.toHaveProperty('d');
        expect(key).not.toHaveProperty('p');
      }
    });

    it('serves the key set raw (no response envelope) with cache headers', () => {
      const res = { setHeader: jest.fn(), json: jest.fn() } as any;

      new JwksController(store).getJwks(res);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
      expect(res.json).toHaveBeenCalledWith({ keys: expect.any(Array) });
      expect(res.json.mock.calls[0][0].keys).toHaveLength(2);
    });
  });
});
