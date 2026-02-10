# BYOK Security Runbook

This runbook covers secure operation of user-saved API keys (BYOK), including rotation, migration, incident response, and rollback.

## Security model

- Personal provider keys are encrypted at rest using AES-256-GCM.
- Stored payload format is key-versioned and key-tagged: `v2:<key-id>:<iv>:<auth-tag>:<ciphertext>`.
- The active encryption key is configured by:
  - `USER_API_KEYS_ENCRYPTION_KEY`
  - `USER_API_KEYS_ENCRYPTION_KEY_ID`
- Older `v2` keys can remain decryptable via:
  - `USER_API_KEYS_DECRYPTION_KEYRING` (`keyId=key,keyId=key`)
- Temporary legacy `v1` decrypt compatibility is supported via:
  - `USER_API_KEYS_LEGACY_DECRYPTION_SECRETS`

## Required environment settings

Outside local development (`NODE_ENV != development`), these are required:

- `USER_API_KEYS_ENCRYPTION_KEY`: 32-byte key encoded as base64/base64url or 64-char hex
- `USER_API_KEYS_ENCRYPTION_KEY_ID`: stable identifier for the active key

Recommended:

- `USER_API_KEYS_DECRYPTION_KEYRING` during rotations
- `USER_API_KEYS_LEGACY_DECRYPTION_SECRETS` only while migrating old `v1` records

## Deployment order

1. Generate a new 32-byte key.
2. Assign a new key ID (example: `primary-2026-02`).
3. Set `USER_API_KEYS_ENCRYPTION_KEY` and `USER_API_KEYS_ENCRYPTION_KEY_ID` to the new values.
4. Add the previous active key to `USER_API_KEYS_DECRYPTION_KEYRING`.
5. Deploy application code.
6. Run dry-run migration (`POST /api/admin/security/byok/migrate` with `{"dryRun": true}`).
7. Run live migration (`{"dryRun": false}`), repeat in batches until complete.
8. Verify no legacy payloads remain.
9. Remove obsolete keys from `USER_API_KEYS_DECRYPTION_KEYRING` after validation window.

## Rotation workflow

### 1) Generate key material

```bash
openssl rand -base64 32
```

### 2) Configure env vars

- Set new key/id as active.
- Move previous key to `USER_API_KEYS_DECRYPTION_KEYRING`.

### 3) Run migration endpoint

Admin endpoint:

- `POST /api/admin/security/byok/migrate`

Body:

- `{"dryRun": true, "limit": 250}`
- `{"dryRun": false, "limit": 250}`

Optional:

- `userId` to migrate one account first.

## Legacy migration notes (`v1` -> `v2`)

If existing records were encrypted with old pre-hardening logic:

1. Set `USER_API_KEYS_LEGACY_DECRYPTION_SECRETS` to prior legacy secret values temporarily.
2. Deploy and run migration endpoint (`dryRun` then live run).
3. Validate `v1` count is zero.
4. Remove `USER_API_KEYS_LEGACY_DECRYPTION_SECRETS`.

## Verification commands

Version distribution:

```sql
SELECT split_part("encryptedKey", ':', 1) AS version, COUNT(*) AS count
FROM "UserApiKey"
GROUP BY 1
ORDER BY 1;
```

`v2` key-id distribution:

```sql
SELECT split_part("encryptedKey", ':', 2) AS key_id, COUNT(*) AS count
FROM "UserApiKey"
WHERE "encryptedKey" LIKE 'v2:%'
GROUP BY 1
ORDER BY count DESC;
```

Legacy residue check:

```sql
SELECT COUNT(*) AS v1_remaining
FROM "UserApiKey"
WHERE "encryptedKey" LIKE 'v1:%';
```

## Rollback guidance

If a rotation deploy must be rolled back:

1. Restore previous active values for:
  - `USER_API_KEYS_ENCRYPTION_KEY`
  - `USER_API_KEYS_ENCRYPTION_KEY_ID`
2. Keep the newer key in `USER_API_KEYS_DECRYPTION_KEYRING`.
3. Redeploy.

This preserves decryptability for records written before and after the failed rollout.

## Incident response (suspected key compromise)

1. Generate a new encryption key and key ID immediately.
2. Rotate env vars and deploy with old key in decrypt keyring.
3. Run migration endpoint until complete.
4. Invalidate compromised personal keys (user-facing revocation + regeneration guidance).
5. Review BYOK audit logs for suspicious create/update/delete/use activity.
6. Remove compromised key material from decrypt keyring after verification.

## Backup/restore implications

- Database backups containing BYOK ciphertext are not recoverable without key material.
- Store active and decrypt-only keyring material in a dedicated secret manager/KMS.
- Keep key IDs and key material history for the minimum period needed for restore/rollback.
- Never store raw encryption keys in source control, ticket systems, or plaintext runbooks.

