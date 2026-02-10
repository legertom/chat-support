import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetUserApiKeyCryptoConfigForTests,
  assertUserApiKeyEncryptionConfigured,
  decryptApiKey,
  decryptApiKeyWithMetadata,
  encryptApiKey,
  maskApiKey,
} from "@/lib/user-api-keys";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  USER_API_KEYS_ENCRYPTION_KEY: process.env.USER_API_KEYS_ENCRYPTION_KEY,
  USER_API_KEYS_ENCRYPTION_KEY_ID: process.env.USER_API_KEYS_ENCRYPTION_KEY_ID,
  USER_API_KEYS_DECRYPTION_KEYRING: process.env.USER_API_KEYS_DECRYPTION_KEYRING,
  USER_API_KEYS_LEGACY_DECRYPTION_SECRETS: process.env.USER_API_KEYS_LEGACY_DECRYPTION_SECRETS,
};

describe("user-api-keys crypto hardening", () => {
  beforeEach(() => {
    __resetUserApiKeyCryptoConfigForTests();
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.USER_API_KEYS_DECRYPTION_KEYRING = "";
    process.env.USER_API_KEYS_LEGACY_DECRYPTION_SECRETS = "";
    process.env.USER_API_KEYS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.USER_API_KEYS_ENCRYPTION_KEY_ID = "primary-k1";
  });

  afterEach(() => {
    __resetUserApiKeyCryptoConfigForTests();
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_ENV.NODE_ENV;
    process.env.USER_API_KEYS_ENCRYPTION_KEY = ORIGINAL_ENV.USER_API_KEYS_ENCRYPTION_KEY;
    process.env.USER_API_KEYS_ENCRYPTION_KEY_ID = ORIGINAL_ENV.USER_API_KEYS_ENCRYPTION_KEY_ID;
    process.env.USER_API_KEYS_DECRYPTION_KEYRING = ORIGINAL_ENV.USER_API_KEYS_DECRYPTION_KEYRING;
    process.env.USER_API_KEYS_LEGACY_DECRYPTION_SECRETS = ORIGINAL_ENV.USER_API_KEYS_LEGACY_DECRYPTION_SECRETS;
  });

  it("encrypts and decrypts with v2 and key id metadata", () => {
    const encrypted = encryptApiKey("sk-live-super-secret-value");
    expect(encrypted.startsWith("v2:primary-k1:")).toBe(true);

    const decrypted = decryptApiKeyWithMetadata(encrypted);
    expect(decrypted.apiKey).toBe("sk-live-super-secret-value");
    expect(decrypted.keyVersion).toBe("v2");
    expect(decrypted.keyId).toBe("primary-k1");
    expect(decrypted.shouldReencrypt).toBe(false);
    expect(decryptApiKey(encrypted)).toBe("sk-live-super-secret-value");
  });

  it("decrypts legacy v1 ciphertext via explicit legacy secret and marks for re-encryption", () => {
    const legacySecret = "legacy-auth-secret-value";
    process.env.USER_API_KEYS_LEGACY_DECRYPTION_SECRETS = legacySecret;
    __resetUserApiKeyCryptoConfigForTests();

    const legacyCiphertext = encryptLegacyV1("AIza-legacy-key", legacySecret);
    const decrypted = decryptApiKeyWithMetadata(legacyCiphertext);

    expect(decrypted.apiKey).toBe("AIza-legacy-key");
    expect(decrypted.keyVersion).toBe("v1");
    expect(decrypted.keyId).toBeNull();
    expect(decrypted.shouldReencrypt).toBe(true);
  });

  it("fails closed when required BYOK encryption env vars are missing outside development", () => {
    delete process.env.USER_API_KEYS_ENCRYPTION_KEY;
    delete process.env.USER_API_KEYS_ENCRYPTION_KEY_ID;
    __resetUserApiKeyCryptoConfigForTests();

    expect(() => assertUserApiKeyEncryptionConfigured()).toThrow(/USER_API_KEYS_ENCRYPTION_KEY/);
  });

  it("masks key previews without exposing prefixes", () => {
    expect(maskApiKey("sk-1234567890")).toBe("********7890");
    expect(maskApiKey("abcd")).toBe("********");
  });
});

function encryptLegacyV1(apiKey: string, secret: string): string {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}
