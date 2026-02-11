"use client";

import { useLocalStorage } from "./use-local-storage";
import { DEFAULT_MODEL_ID } from "@/lib/models";

export interface CostScenario {
    id: string;
    label: string;
    inputTokens: number;
    outputTokens: number;
    explanation: string;
}

export interface ResearchSettings {
    ragEnabled: boolean;
    ragChunkSize: number;
    ragTopK: number;
    dailyVolume: number;
    markupPercent: number;
    anchorModelId: string;
    promptCachingEnabled: boolean;
    temperature: number;
    maxOutputTokens: number;
}

export const INITIAL_SCENARIOS: CostScenario[] = [
    {
        id: "quick",
        label: "Quick reply",
        inputTokens: 700,
        outputTokens: 220,
        explanation: "Simple question and short answer",
    },
    {
        id: "standard",
        label: "Standard reply",
        inputTokens: 1800,
        outputTokens: 550,
        explanation: "Typical support question with context",
    },
    {
        id: "deep",
        label: "Deep reply",
        inputTokens: 4500,
        outputTokens: 1200,
        explanation: "Long thread with step-by-step guidance",
    },
];

export const INITIAL_RESEARCH_SETTINGS: ResearchSettings = {
    ragEnabled: false,
    ragChunkSize: 350,
    ragTopK: 6,
    dailyVolume: 1,
    markupPercent: 0,
    anchorModelId: DEFAULT_MODEL_ID,
    promptCachingEnabled: false,
    temperature: 0.2,
    maxOutputTokens: 1200,
};

export function usePersistentSettings() {
    const [scenarios, setScenarios, scenariosHydrated] = useLocalStorage<CostScenario[]>(
        "researcher_scenarios",
        INITIAL_SCENARIOS
    );

    const [settings, setSettings, settingsHydrated] = useLocalStorage<ResearchSettings>(
        "researcher_settings",
        INITIAL_RESEARCH_SETTINGS
    );

    const updateSetting = <K extends keyof ResearchSettings>(key: K, value: ResearchSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const updateScenario = (id: string, field: "inputTokens" | "outputTokens", value: number) => {
        setScenarios(prev =>
            prev.map(s => (s.id === id ? { ...s, [field]: value } : s))
        );
    };

    return {
        scenarios,
        settings,
        updateSetting,
        updateScenario,
        isHydrated: scenariosHydrated && settingsHydrated
    };
}
