import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL_ID, MODEL_SPECS, type ModelSpec } from "@/lib/models";
import { fetchStats } from "@/components/api-client";

export function useModelCatalog() {
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [availableModels, setAvailableModels] = useState<ModelSpec[]>(MODEL_SPECS);

  useEffect(() => {
    void loadModelCatalog();
  }, []);

  async function loadModelCatalog() {
    try {
      const stats = await fetchStats();
      if (Array.isArray(stats.models) && stats.models.length > 0) {
        setAvailableModels(stats.models as ModelSpec[]);
        setModelId((current) => {
          if (stats.models.some((model) => model.id === current)) {
            return current;
          }
          if (stats.models.some((model) => model.id === DEFAULT_MODEL_ID)) {
            return DEFAULT_MODEL_ID;
          }
          return stats.models[0].id;
        });
      }
    } catch (error) {
      console.error("Failed to load model catalog:", error);
    }
  }

  return {
    modelId,
    setModelId,
    availableModels,
  };
}
