import { useEffect, useState } from "react";
import {
  fetchMe,
  fetchApiKeys,
  createApiKey,
  deleteApiKey,
  type MeResponse,
  type UserApiKeyItem,
  type ApiKeyProvider,
} from "@/components/api-client";

export function useUserProfile() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [apiKeys, setApiKeys] = useState<UserApiKeyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadProfile();
  }, []);

  async function loadProfile() {
    try {
      setIsLoading(true);
      const profile = await fetchMe();
      setMe(profile);
    } catch (error) {
      console.error("Failed to load profile:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshMe() {
    try {
      const profile = await fetchMe();
      setMe(profile);
    } catch (error) {
      console.error("Failed to refresh profile:", error);
      throw error;
    }
  }

  async function loadApiKeys() {
    try {
      const response = await fetchApiKeys();
      setApiKeys(response.items);
    } catch (error) {
      console.error("Failed to load API keys:", error);
      throw error;
    }
  }

  async function createKey(provider: ApiKeyProvider, label: string, apiKey: string): Promise<UserApiKeyItem> {
    const response = await createApiKey({ provider, label, apiKey });
    await loadApiKeys();
    return response.key;
  }

  async function deleteKey(id: string) {
    await deleteApiKey(id);
    await loadApiKeys();
  }

  return {
    me,
    apiKeys,
    refreshMe,
    loadApiKeys,
    createKey,
    deleteKey,
    isLoading,
  };
}
