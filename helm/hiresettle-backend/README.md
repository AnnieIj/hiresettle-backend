# hiresettle-backend Helm chart

Reference deployment for the HireSettle API (#510). It renders:

| Resource | Notes |
| --- | --- |
| `Deployment` | Non-root, read-only root FS, rolling updates with `maxUnavailable: 0`, optional `prisma migrate deploy` init container |
| `Service` | `ClusterIP` on port 80 → container port `http` (3000) |
| `ConfigMap` | Non-secret env from `.Values.config`, loaded with `envFrom` |
| `Secret` | Only when `secrets.existingSecret` is empty; otherwise references your Secret |
| `HorizontalPodAutoscaler` | `autoscaling/v2`, CPU + memory targets |
| `PodDisruptionBudget` | Keeps at least one pod during node drains |
| `ServiceAccount` | Token automount disabled |

## Probes

| Probe | Path | Checks |
| --- | --- | --- |
| startup / liveness | `/healthz/live` | Process responds (no dependencies) |
| readiness | `/healthz/ready` | Postgres + Redis reachable, else 503 |

Both paths, like `/.well-known/jwks.json`, are served outside the `api/v1` prefix.

## Install

```bash
kubectl create secret generic hiresettle-backend-env \
  --from-literal=DATABASE_URL=... --from-literal=REDIS_URL=... \
  --from-literal=JWT_SECRET=... --from-literal=SOROBAN_CONTRACT_ADDRESS=... \
  --from-literal=SMTP_HOST=... --from-literal=SMTP_USER=... --from-literal=SMTP_PASS=...

kubectl create secret generic hiresettle-backend-jwt-keys \
  --from-file=signing-keys.json=./signing-keys.json

helm upgrade --install hiresettle ./helm/hiresettle-backend \
  --set secrets.existingSecret=hiresettle-backend-env \
  --set jwtSigningKeys.existingSecret=hiresettle-backend-jwt-keys
```

## JWT signing keys and rotation (#481)

`signing-keys.json` is a JSON array:

```json
[
  { "kid": "2026-10", "privateKey": "-----BEGIN PRIVATE KEY-----\n..." },
  { "kid": "2026-07", "publicKey": "-----BEGIN PUBLIC KEY-----\n..." }
]
```

Generate a key with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out key.pem`.

To rotate:

1. Add the new key (with `privateKey`) first in the array. Change the old entry to `publicKey` only.
2. Update the Secret and run `kubectl rollout restart deployment/<release>-hiresettle-backend`.
   New tokens are signed with the new `kid`. Tokens signed with the old key still verify.
3. Once the longest token lifetime has passed (`JWT_REFRESH_EXPIRES_IN`), remove the old entry.

Set `JWT_ACTIVE_KID` through `extraEnv` to choose the signing key explicitly.

## Validate locally

```bash
helm lint helm/hiresettle-backend -f helm/hiresettle-backend/ci/default-values.yaml
helm template t helm/hiresettle-backend -f helm/hiresettle-backend/ci/default-values.yaml \
  | kubeconform -strict -summary -kubernetes-version 1.29.0
```

CI runs the same checks for every file in `ci/` (`.github/workflows/helm.yml`).
