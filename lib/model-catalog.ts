import "server-only";

import { MODEL_SPECS, type ModelSpec } from "./models";
import { prisma } from "./prisma";
import { getDynamicServerModelCatalog } from "./server-models";

export async function getStatsModelCatalogForUser(userId: string): Promise<ModelSpec[]> {
  const allowClientApiKeyOverride = process.env.ALLOW_CLIENT_API_KEY_OVERRIDE === "true";
  const dynamicCatalog = await getDynamicServerModelCatalog({ allowClientApiKeyOverride });
  if (dynamicCatalog.length > 0) {
    return dynamicCatalog;
  }

  const personalProviders = await prisma.userApiKey.findMany({
    where: {
      userId,
    },
    select: {
      provider: true,
    },
  });
  const providerSet = new Set(personalProviders.map((item) => item.provider));
  return MODEL_SPECS.filter((model) => providerSet.has(model.provider));
}

export async function getDropdownModelCatalogForUser(userId: string): Promise<ModelSpec[]> {
  const statsCatalog = await getStatsModelCatalogForUser(userId);
  if (statsCatalog.length > 0) {
    return statsCatalog;
  }
  return MODEL_SPECS;
}
