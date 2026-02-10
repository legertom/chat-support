const TEST_BYOK_KEY = Buffer.alloc(32, 7).toString("base64");

if (!process.env.USER_API_KEYS_ENCRYPTION_KEY) {
  process.env.USER_API_KEYS_ENCRYPTION_KEY = TEST_BYOK_KEY;
}

if (!process.env.USER_API_KEYS_ENCRYPTION_KEY_ID) {
  process.env.USER_API_KEYS_ENCRYPTION_KEY_ID = "test-kid";
}

