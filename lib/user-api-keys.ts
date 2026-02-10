import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError } from "@/lib/http";
import type { ApiKeyProvider } from "@prisma/client";

const CIPHER_ALGO = "aes-256-gcm";
const CIPHER_KEY_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const CURRENT_ENCRYPTION_VERSION = "v2";
const LEGACY_ENCRYPTION_VERSION = "v1";
const DEV_ENCRYPTION_KEY_ID = "local-dev";
const DEV_ENCRYPTION_SECRET = "chat-support-dev-user-api-keys-only";
const ENCRYPTION_KEY_ENV = "USER_API_KEYS_ENCRYPTION_KEY";
const ENCRYPTION_KEY_ID_ENV = "USER_API_KEYS_ENCRYPTION_KEY_ID";
const DECRYPTION_KEYRING_ENV = "USER_API_KEYS_DECRYPTION_KEYRING";
const LEGACY_DECRYPTION_SECRETS_ENV = "USER_API_KEYS_LEGACY_DECRYPTION_SECRETS";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;

export interface UserApiKeyPublicRecord {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  keyPreview: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecryptedUserApiKey {
  apiKey: string;
  keyVersion: string;
  keyId: string | null;
  shouldReencrypt: boolean;
}

interface UserApiKeyCryptoConfig {
  currentKeyId: string;
  currentKey: Buffer;
  keyedDecryptors: Map<string, Buffer>;
  legacyV1Decryptors: Buffer[];
}

let cachedConfig: UserApiKeyCryptoConfig | null = null;
let cachedEnvFingerprint: string | null = null;

export function assertUserApiKeyEncryptionConfigured(): void {
  resolveCryptoConfig();
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "********";
  }
  return `********${trimmed.slice(-4)}`;
}

export function encryptApiKey(plainText: string): string {
  const value = plainText.trim();
  if (!value) {
    throw new ApiError(400, "API key is required.", "missing_api_key");
  }

  const config = resolveCryptoConfig();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(CIPHER_ALGO, config.currentKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${CURRENT_ENCRYPTION_VERSION}:${config.currentKeyId}:${iv.toString("base64")}:${authTag.toString(
    "base64"
  )}:${encrypted.toString("base64")}`;
}

export function decryptApiKey(serialized: string): string {
  return decryptApiKeyWithMetadata(serialized).apiKey;
}

export function decryptApiKeyWithMetadata(serialized: string): DecryptedUserApiKey {
  const config = resolveCryptoConfig();
  const parts = serialized.split(":");

  if (parts.length === 5 && parts[0] === CURRENT_ENCRYPTION_VERSION) {
    const keyId = parts[1]?.trim() ?? "";
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
    }

    const keyMaterial = config.keyedDecryptors.get(keyId);
    if (!keyMaterial) {
      throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
    }

    const decrypted = decryptWithAesGcm({
      key: keyMaterial,
      iv: decodeBase64(parts[2]),
      authTag: decodeBase64(parts[3]),
      encrypted: decodeBase64(parts[4]),
    });

    return {
      apiKey: decrypted,
      keyVersion: CURRENT_ENCRYPTION_VERSION,
      keyId,
      shouldReencrypt: keyId !== config.currentKeyId,
    };
  }

  if (parts.length === 4 && parts[0] === LEGACY_ENCRYPTION_VERSION) {
    const iv = decodeBase64(parts[1]);
    const authTag = decodeBase64(parts[2]);
    const encrypted = decodeBase64(parts[3]);

    const decryptionCandidates = new Map<string, Buffer>();
    decryptionCandidates.set("current", config.currentKey);
    for (const [candidateKeyId, candidateKey] of config.keyedDecryptors.entries()) {
      decryptionCandidates.set(`keyed:${candidateKeyId}`, candidateKey);
    }
    config.legacyV1Decryptors.forEach((candidateKey, index) => {
      decryptionCandidates.set(`legacy:${index}`, candidateKey);
    });

    for (const candidateKey of decryptionCandidates.values()) {
      const decrypted = decryptWithAesGcm(
        {
          key: candidateKey,
          iv,
          authTag,
          encrypted,
        },
        true
      );
      if (decrypted) {
        return {
          apiKey: decrypted,
          keyVersion: LEGACY_ENCRYPTION_VERSION,
          keyId: null,
          shouldReencrypt: true,
        };
      }
    }

    throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
  }

  throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
}

export function __resetUserApiKeyCryptoConfigForTests(): void {
  cachedConfig = null;
  cachedEnvFingerprint = null;
}

function resolveCryptoConfig(): UserApiKeyCryptoConfig {
  const envFingerprint = [
    process.env.NODE_ENV ?? "",
    process.env[ENCRYPTION_KEY_ENV] ?? "",
    process.env[ENCRYPTION_KEY_ID_ENV] ?? "",
    process.env[DECRYPTION_KEYRING_ENV] ?? "",
    process.env[LEGACY_DECRYPTION_SECRETS_ENV] ?? "",
  ].join("|");

  if (cachedConfig && cachedEnvFingerprint === envFingerprint) {
    return cachedConfig;
  }

  const isDevelopment = process.env.NODE_ENV === "development";
  const currentKeyRaw = process.env[ENCRYPTION_KEY_ENV]?.trim();
  const currentKeyIdRaw = process.env[ENCRYPTION_KEY_ID_ENV]?.trim();

  if (!isDevelopment) {
    if (!currentKeyRaw) {
      throw new Error(`${ENCRYPTION_KEY_ENV} is required outside development.`);
    }
    if (!currentKeyIdRaw) {
      throw new Error(`${ENCRYPTION_KEY_ID_ENV} is required outside development.`);
    }
  }

  const currentKeyId = normalizeKeyId(currentKeyIdRaw || DEV_ENCRYPTION_KEY_ID, ENCRYPTION_KEY_ID_ENV);
  const currentKey = currentKeyRaw
    ? parseAes256KeyMaterial(currentKeyRaw, ENCRYPTION_KEY_ENV)
    : createHash("sha256").update(DEV_ENCRYPTION_SECRET, "utf8").digest();

  const keyedDecryptors = new Map<string, Buffer>();
  keyedDecryptors.set(currentKeyId, currentKey);

  const ringEntries = parseKeyringEnv(process.env[DECRYPTION_KEYRING_ENV]);
  for (const [keyId, keyMaterial] of ringEntries) {
    if (keyId === currentKeyId) {
      continue;
    }
    keyedDecryptors.set(keyId, parseAes256KeyMaterial(keyMaterial, DECRYPTION_KEYRING_ENV));
  }

  const legacyV1Decryptors = parseLegacySecretsEnv(process.env[LEGACY_DECRYPTION_SECRETS_ENV]).map((secret) =>
    createHash("sha256").update(secret, "utf8").digest()
  );

  cachedConfig = {
    currentKeyId,
    currentKey,
    keyedDecryptors,
    legacyV1Decryptors,
  };
  cachedEnvFingerprint = envFingerprint;
  return cachedConfig;
}

function normalizeKeyId(value: string, envName: string): string {
  const keyId = value.trim();
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(`${envName} must match ${KEY_ID_PATTERN.toString()}.`);
  }
  return keyId;
}

function parseKeyringEnv(raw: string | undefined): Array<[string, string]> {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
        throw new Error(`${DECRYPTION_KEYRING_ENV} entries must use keyId=keyMaterial format.`);
      }

      const keyId = normalizeKeyId(entry.slice(0, separatorIndex), DECRYPTION_KEYRING_ENV);
      const keyMaterial = entry.slice(separatorIndex + 1).trim();
      if (!keyMaterial) {
        throw new Error(`${DECRYPTION_KEYRING_ENV} entries must include key material.`);
      }

      return [keyId, keyMaterial] as [string, string];
    });
}

function parseLegacySecretsEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseAes256KeyMaterial(value: string, envName: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${envName} must not be empty.`);
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const normalized = normalizeBase64(trimmed);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`${envName} must be a 32-byte key encoded as base64/base64url or 64-char hex.`);
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length !== CIPHER_KEY_BYTES) {
    throw new Error(`${envName} must decode to exactly ${CIPHER_KEY_BYTES} bytes.`);
  }

  return decoded;
}

function decodeBase64(input: string): Buffer {
  const normalized = normalizeBase64(input);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
  }
  return Buffer.from(normalized, "base64");
}

function normalizeBase64(input: string): string {
  const value = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (value.length === 0) {
    return "";
  }
  const remainder = value.length % 4;
  return remainder === 0 ? value : `${value}${"=".repeat(4 - remainder)}`;
}

function decryptWithAesGcm(
  input: {
    key: Buffer;
    iv: Buffer;
    authTag: Buffer;
    encrypted: Buffer;
  },
  suppressError: true
): string | null;
function decryptWithAesGcm(
  input: {
    key: Buffer;
    iv: Buffer;
    authTag: Buffer;
    encrypted: Buffer;
  },
  suppressError?: false
): string;
function decryptWithAesGcm(
  input: {
    key: Buffer;
    iv: Buffer;
    authTag: Buffer;
    encrypted: Buffer;
  },
  suppressError = false
): string | null {
  if (input.iv.length !== IV_LENGTH_BYTES || input.authTag.length !== AUTH_TAG_LENGTH_BYTES || input.encrypted.length === 0) {
    if (suppressError) {
      return null;
    }
    throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
  }

  try {
    const decipher = createDecipheriv(CIPHER_ALGO, input.key, input.iv);
    decipher.setAuthTag(input.authTag);
    const decrypted = Buffer.concat([decipher.update(input.encrypted), decipher.final()]);
    const value = decrypted.toString("utf8").trim();
    if (!value) {
      throw new Error("empty");
    }
    return value;
  } catch {
    if (suppressError) {
      return null;
    }
    throw new ApiError(500, "Unable to decrypt stored API key.", "api_key_decrypt_failed");
  }
}
