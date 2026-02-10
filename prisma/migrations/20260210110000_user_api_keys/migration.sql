-- CreateEnum
CREATE TYPE "ApiKeyProvider" AS ENUM ('openai', 'anthropic', 'gemini');

-- CreateTable
CREATE TABLE "UserApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ApiKeyProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "keyPreview" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserApiKey_userId_createdAt_idx" ON "UserApiKey"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UserApiKey_userId_label_key" ON "UserApiKey"("userId", "label");

-- AddForeignKey
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
