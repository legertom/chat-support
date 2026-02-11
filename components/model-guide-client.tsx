"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { calculateCost, DEFAULT_MODEL_ID, parseModelId, resolveModelPricingMetadata, type ModelSpec } from "@/lib/models";

import { usePersistentSettings, type CostScenario, type ResearchSettings } from "./hooks/use-persistent-settings";

interface ModelGuideClientProps {
    initialModelCatalog: ModelSpec[];
}

export function ModelGuideClient({ initialModelCatalog }: ModelGuideClientProps) {
    const { scenarios, settings, updateSetting, updateScenario, isHydrated } = usePersistentSettings();
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [justSaved, setJustSaved] = useState(false);

    // Effect to show a "Settings Saved" flash when things change
    useEffect(() => {
        if (!isHydrated) return;
        setJustSaved(true);
        const timer = setTimeout(() => setJustSaved(false), 2000);
        return () => clearTimeout(timer);
    }, [scenarios, settings, isHydrated]);

    const models = useMemo(() => {
        const pricedModels = initialModelCatalog.map(resolveModelPricingForDisplay);
        return sortModelsForDisplay(pricedModels, scenarios[1], settings);
    }, [initialModelCatalog, scenarios, settings]);

    const costsByModel = useMemo(() => {
        const map = new Map<string, Record<string, number | null>>();
        for (const model of models) {
            map.set(model.id, {
                quick: estimateScenarioCost(model, scenarios[0], settings),
                standard: estimateScenarioCost(model, scenarios[1], settings),
                deep: estimateScenarioCost(model, scenarios[2], settings),
            });
        }
        return map;
    }, [models, scenarios, settings]);

    const anchorModel = useMemo(() =>
        models.find(m => m.id === settings.anchorModelId) || models[0],
        [models, settings.anchorModelId]
    );

    const cheapestPricedModel = useMemo(() =>
        models.find((model) => typeof costsByModel.get(model.id)?.standard === "number"),
        [models, costsByModel]
    );

    const mostExpensivePricedModel = useMemo(() =>
        [...models].reverse().find((model) => typeof costsByModel.get(model.id)?.standard === "number"),
        [models, costsByModel]
    );

    const defaultModel = models.find((model) => model.id === DEFAULT_MODEL_ID) ?? null;
    const anchorStandardCost = costsByModel.get(anchorModel.id)?.standard ?? null;

    const handleScenarioChange = (id: string, field: "inputTokens" | "outputTokens", value: number) => {
        updateScenario(id, field, value);
    };

    const handleSettingChange = <K extends keyof ResearchSettings>(key: K, value: ResearchSettings[K]) => {
        updateSetting(key, value);
    };

    return (
        <div className="models-shell">
            <header className="models-header panel">
                <div>
                    <p className="eyebrow">Model Guide</p>
                    <h1>Model Strengths And Costs</h1>
                    <p className="subtitle">
                        This page uses the same model catalog as the chat model dropdown, then explains each option in plain language.
                    </p>
                </div>

                <div className="models-header-actions">
                    <Link href="/" className="ghost-link">
                        Back To Chat
                    </Link>
                </div>
            </header>

            <section className="panel models-intro">
                <div className="models-intro-header">
                    <div>
                        <h2>Simulation Controls</h2>
                        <p>
                            Adjust benchmarks and simulation variables below to see how they impact costs in different environments.
                        </p>
                    </div>
                    <div className="researcher-badge">Researcher Mode</div>
                </div>

                <div className="research-toolbar">
                    <button
                        className={`ghost-button advanced-toggle ${showAdvanced ? "active" : ""}`}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                    >
                        {showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings"}
                    </button>

                    {settings.dailyVolume > 1 && (
                        <div className="volume-pill">
                            Showing Projected Cost for {settings.dailyVolume.toLocaleString()} daily messages
                        </div>
                    )}

                    {justSaved && isHydrated && (
                        <div className="save-indicator">
                            ✓ Settings Saved
                        </div>
                    )}
                </div>

                {showAdvanced && (
                    <div className="advanced-settings-panel">
                        <div className="settings-grid">
                            <div className="settings-group">
                                <h3>RAG Overhead</h3>
                                <label className="check-label">
                                    <input
                                        type="checkbox"
                                        checked={settings.ragEnabled}
                                        onChange={(e) => handleSettingChange("ragEnabled", e.target.checked)}
                                    />
                                    Enable RAG Context Simulation
                                </label>
                                {settings.ragEnabled && (
                                    <div className="nested-controls">
                                        <div className="control-group">
                                            <label>Chunk Size ({settings.ragChunkSize} tokens)</label>
                                            <input
                                                type="range" min="100" max="1500" step="50"
                                                value={settings.ragChunkSize}
                                                onChange={(e) => handleSettingChange("ragChunkSize", parseInt(e.target.value))}
                                            />
                                        </div>
                                        <div className="control-group">
                                            <label>Top-K ({settings.ragTopK} chunks)</label>
                                            <input
                                                type="range" min="1" max="20" step="1"
                                                value={settings.ragTopK}
                                                onChange={(e) => handleSettingChange("ragTopK", parseInt(e.target.value))}
                                            />
                                        </div>
                                        <p className="calc-note">
                                            Total Overhead: +{(settings.ragChunkSize * settings.ragTopK).toLocaleString()} input tokens
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="settings-group">
                                <h3>Usage & Volume</h3>
                                <div className="control-group">
                                    <label>Daily Volume ({settings.dailyVolume.toLocaleString()} msgs)</label>
                                    <input
                                        type="range" min="1" max="10000" step="100"
                                        value={settings.dailyVolume}
                                        onChange={(e) => handleSettingChange("dailyVolume", parseInt(e.target.value))}
                                    />
                                    <input
                                        type="number"
                                        value={settings.dailyVolume}
                                        onChange={(e) => handleSettingChange("dailyVolume", parseInt(e.target.value) || 1)}
                                    />
                                </div>
                                <div className="control-group">
                                    <label>Markup / Margin ({settings.markupPercent}%)</label>
                                    <input
                                        type="range" min="0" max="500" step="5"
                                        value={settings.markupPercent}
                                        onChange={(e) => handleSettingChange("markupPercent", parseInt(e.target.value))}
                                    />
                                </div>
                            </div>

                            <div className="settings-group">
                                <h3>Relative Anchor</h3>
                                <div className="control-group">
                                    <label>Compare all models to:</label>
                                    <select
                                        value={settings.anchorModelId}
                                        onChange={(e) => handleSettingChange("anchorModelId", e.target.value)}
                                    >
                                        {models.map(m => (
                                            <option key={m.id} value={m.id}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <p className="calc-note">
                                    Anchor: <strong>{anchorModel.label}</strong>
                                </p>
                            </div>

                            <div className="settings-group">
                                <h3>Efficiency</h3>
                                <label className="check-label">
                                    <input
                                        type="checkbox"
                                        checked={settings.promptCachingEnabled}
                                        onChange={(e) => handleSettingChange("promptCachingEnabled", e.target.checked)}
                                    />
                                    Simulate Prompt Caching
                                </label>
                                {settings.promptCachingEnabled && (
                                    <p className="calc-note">
                                        Assumes ~50% cost reduction on input tokens for repetitive context.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div className="models-legend-grid">
                    {scenarios.map((scenario) => (
                        <article key={scenario.id} className="models-legend-card scenario-editor">
                            <div className="scenario-header">
                                <h3>{scenario.label}</h3>
                            </div>
                            <p className="scenario-explanation">{scenario.explanation}</p>

                            <div className="editor-controls">
                                <div className="control-group">
                                    <label>Base Input Tokens</label>
                                    <div className="input-with-val">
                                        <input
                                            type="number"
                                            value={scenario.inputTokens}
                                            onChange={(e) => handleScenarioChange(scenario.id, "inputTokens", parseInt(e.target.value) || 0)}
                                        />
                                        {settings.ragEnabled && (
                                            <span className="rag-add">
                                                +{(settings.ragChunkSize * settings.ragTopK).toLocaleString()} RAG
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="range"
                                        min="100"
                                        max="32000"
                                        step="100"
                                        value={scenario.inputTokens}
                                        onChange={(e) => handleScenarioChange(scenario.id, "inputTokens", parseInt(e.target.value) || 0)}
                                    />
                                </div>
                                <div className="control-group">
                                    <label>Output Tokens</label>
                                    <input
                                        type="number"
                                        value={scenario.outputTokens}
                                        onChange={(e) => handleScenarioChange(scenario.id, "outputTokens", parseInt(e.target.value) || 0)}
                                    />
                                    <input
                                        type="range"
                                        min="50"
                                        max="4096"
                                        step="10"
                                        value={scenario.outputTokens}
                                        onChange={(e) => handleScenarioChange(scenario.id, "outputTokens", parseInt(e.target.value) || 0)}
                                    />
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="panel models-picks">
                <h2>Quick Picks</h2>
                <div className="models-pick-grid">
                    <article className="models-pick-card">
                        <h3>Default In This App</h3>
                        <p>{defaultModel?.label ?? "Not set"}</p>
                    </article>
                    <article className="models-pick-card">
                        <h3>Lowest Projected Cost</h3>
                        <p>{cheapestPricedModel?.label ?? "Pricing unavailable"}</p>
                    </article>
                    <article className="models-pick-card">
                        <h3>Highest Projected Cost</h3>
                        <p>{mostExpensivePricedModel?.label ?? "Pricing unavailable"}</p>
                    </article>
                </div>
            </section>

            <section className="panel models-costs">
                <h2>Side-By-Side Projections</h2>
                <div className="models-table-wrap">
                    <table className="models-table">
                        <thead>
                            <tr>
                                <th>Model</th>
                                {scenarios.map((scenario) => (
                                    <th key={scenario.id}>{scenario.label}</th>
                                ))}
                                <th>Input Rate</th>
                                <th>Output Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            {models.map((model) => {
                                const modelCosts = costsByModel.get(model.id) ?? { quick: null, standard: null, deep: null };
                                return (
                                    <tr key={model.id} className={model.id === DEFAULT_MODEL_ID ? "models-table-default-row" : ""}>
                                        <td>
                                            <strong>{model.label}</strong>
                                            <p className="models-table-provider">{model.provider.toUpperCase()}</p>
                                        </td>
                                        <td>{formatCostOrUnknown(modelCosts.quick)}</td>
                                        <td>{formatCostOrUnknown(modelCosts.standard)}</td>
                                        <td>{formatCostOrUnknown(modelCosts.deep)}</td>
                                        <td>{formatRateOrUnresolved(model, "input")}</td>
                                        <td>{formatRateOrUnresolved(model, "output")}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <p className="muted">
                    Projections assume {settings.dailyVolume.toLocaleString()} messages per day
                    {settings.markupPercent > 0 ? ` with a ${settings.markupPercent}% margin.` : "."}
                </p>
            </section>

            <section className="models-card-grid">
                {models.map((model) => {
                    const modelCosts = costsByModel.get(model.id) ?? { quick: null, standard: null, deep: null };
                    const standardCost = modelCosts.standard;
                    const relativeToAnchor =
                        typeof standardCost === "number" && typeof anchorStandardCost === "number" && anchorStandardCost > 0
                            ? standardCost / anchorStandardCost
                            : null;
                    const guideCopy = buildGuideCopy(model, relativeToAnchor, anchorModel.label);

                    return (
                        <article key={model.id} className="panel model-card">
                            <div className="model-card-head">
                                <div>
                                    <h2>{model.label}</h2>
                                    <p className="model-provider">
                                        {model.provider.toUpperCase()} | <code>{model.apiModel}</code>
                                    </p>
                                </div>
                                {model.id === DEFAULT_MODEL_ID ? <span className="model-default-pill">Default</span> : null}
                                {model.id === settings.anchorModelId ? <span className="anchor-pill">Anchor</span> : null}
                            </div>

                            <p className="model-summary">{guideCopy.summary}</p>

                            <div className="model-pill-row">
                                <span className="model-pill">{scenarios[0].label}: {formatCostOrUnknown(modelCosts.quick)}</span>
                                <span className="model-pill">{scenarios[1].label}: {formatCostOrUnknown(modelCosts.standard)}</span>
                                <span className="model-pill">{scenarios[2].label}: {formatCostOrUnknown(modelCosts.deep)}</span>
                                <span className="model-pill">
                                    Relative cost:{" "}
                                    {typeof relativeToAnchor === "number" ? `${relativeToAnchor.toFixed(relativeToAnchor >= 10 ? 1 : 2)}x` : "N/A"}
                                </span>
                            </div>

                            <div className="model-guidance-grid">
                                <section className="model-guidance">
                                    <h3>Best For</h3>
                                    <ul>
                                        {guideCopy.bestFor.map((item: string) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </section>

                                <section className="model-guidance">
                                    <h3>Not Ideal For</h3>
                                    <ul>
                                        {guideCopy.notIdealFor.map((item: string) => (
                                            <li key={item}>{item}</li>
                                        ))}
                                    </ul>
                                </section>
                            </div>

                            <p className="model-footnote">
                                Pricing data:{" "}
                                {model.pricingAsOf ? (
                                    <span>as of {formatDateLabel(model.pricingAsOf)}</span>
                                ) : (
                                    <span>date not listed</span>
                                )}
                                {model.pricingSource ? (
                                    <>
                                        {" "}
                                        via{" "}
                                        <a href={model.pricingSource} target="_blank" rel="noreferrer">
                                            source
                                        </a>
                                    </>
                                ) : null}
                                {model.pricingNotes ? <>. {model.pricingNotes}</> : null}
                            </p>
                        </article>
                    );
                })}
            </section>

            <style jsx>{`
                .models-intro-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 1.5rem;
                }
                .researcher-badge {
                    background: var(--accent-cool);
                    color: white;
                    padding: 0.25rem 0.75rem;
                    border-radius: 999px;
                    font-size: 0.75rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }
                .research-toolbar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1.5rem;
                    padding-bottom: 1rem;
                    border-bottom: 2px solid var(--line);
                }
                .advanced-toggle.active {
                    background: #eaf2f8;
                    border-color: var(--accent-cool);
                }
                .volume-pill {
                    background: #f0f7f4;
                    color: #1a5c3e;
                    border: 1px solid #c9e3d6;
                    padding: 0.35rem 0.75rem;
                    border-radius: 999px;
                    font-size: 0.75rem;
                    font-weight: 600;
                }
                .advanced-settings-panel {
                    background: #f8fafc;
                    border: 1px solid var(--line);
                    border-radius: 12px;
                    padding: 1.25rem;
                    margin-bottom: 1.5rem;
                    animation: reveal 300ms ease;
                }
                .settings-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 1.5rem;
                }
                .settings-group {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .settings-group h3 {
                    margin: 0;
                    font-size: 0.85rem;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: var(--muted);
                }
                .check-label {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.85rem;
                    cursor: pointer;
                }
                .nested-controls {
                    padding-left: 1rem;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    border-left: 2px solid var(--line);
                }
                .calc-note {
                    font-size: 0.75rem;
                    color: var(--muted);
                    margin: 0;
                    font-style: italic;
                }
                .scenario-editor {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .scenario-explanation {
                    font-size: 0.85rem;
                    color: var(--muted);
                    margin-bottom: 0.5rem;
                    min-height: 2.5rem;
                }
                .editor-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    padding-top: 1rem;
                    border-top: 1px solid var(--line);
                }
                .control-group {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 0.35rem;
                }
                .control-group label {
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: var(--ink);
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }
                .input-with-val {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .rag-add {
                    font-size: 0.7rem;
                    color: #2b5572;
                    background: #eaf2f8;
                    padding: 0.1rem 0.4rem;
                    border-radius: 4px;
                    font-weight: 700;
                }
                .control-group input[type="number"],
                .control-group select {
                    border: 1px solid var(--line-strong);
                    border-radius: 6px;
                    padding: 0.35rem;
                    font-size: 0.85rem;
                    width: 100%;
                }
                .control-group input[type="range"] {
                    width: 100%;
                    cursor: pointer;
                }
                .anchor-pill {
                    background: #6366f1;
                    color: white;
                    padding: 0.25rem 0.75rem;
                    border-radius: 999px;
                    font-size: 0.7rem;
                    font-weight: 700;
                    margin-left: 0.5rem;
                }
                .save-indicator {
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: #1a5c3e;
                    background: #f0f7f4;
                    padding: 0.25rem 0.75rem;
                    border-radius: 999px;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    50% { opacity: 1; }
                    100% { opacity: 0.4; }
                }
            `}</style>
        </div >
    );
}

// Helper functions (copied from page.tsx to keep it self-contained)

function resolveModelPricingForDisplay(model: ModelSpec): ModelSpec {
    if (typeof model.inputPerMillionUsd === "number" && typeof model.outputPerMillionUsd === "number") {
        return model;
    }

    const parsed = parseModelId(model.id);
    if (!parsed) {
        return model;
    }

    return {
        ...model,
        ...resolveModelPricingMetadata(parsed.provider, parsed.apiModel),
    };
}

function estimateScenarioCost(model: ModelSpec, scenario: CostScenario, settings: ResearchSettings): number | null {
    const inputWithRag = scenario.inputTokens + (settings.ragEnabled ? settings.ragChunkSize * settings.ragTopK : 0);

    // Simple prompt caching simulation: assume 50% of input tokens are cached/discounted if enabled
    const effectiveInputTokens = settings.promptCachingEnabled ? inputWithRag * 0.5 : inputWithRag;

    const result = calculateCost(
        {
            inputTokens: effectiveInputTokens,
            outputTokens: scenario.outputTokens,
            totalTokens: effectiveInputTokens + scenario.outputTokens,
        },
        model.id,
        model
    );

    if (!result.hasPricing) {
        return null;
    }

    let total = result.totalCostUsd * settings.dailyVolume;
    if (settings.markupPercent > 0) {
        total *= (1 + settings.markupPercent / 100);
    }

    return total;
}

function sortModelsForDisplay(models: ModelSpec[], standardScenario: CostScenario, settings: ResearchSettings): ModelSpec[] {
    return [...models].sort((left, right) => {
        const leftStandardCost = estimateScenarioCost(left, standardScenario, settings);
        const rightStandardCost = estimateScenarioCost(right, standardScenario, settings);

        if (typeof leftStandardCost === "number" && typeof rightStandardCost === "number") {
            if (leftStandardCost !== rightStandardCost) {
                return leftStandardCost - rightStandardCost;
            }
        } else if (typeof leftStandardCost === "number") {
            return -1;
        } else if (typeof rightStandardCost === "number") {
            return 1;
        }

        return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
    });
}

interface GuideCopy {
    summary: string;
    bestFor: string[];
    notIdealFor: string[];
}

function buildGuideCopy(model: ModelSpec, relativeToAnchor: number | null, anchorLabel: string): GuideCopy {
    // Re-implementing the logic from page.tsx
    const normalizedApiModel = model.apiModel.toLowerCase();
    const relativeCostText =
        typeof relativeToAnchor === "number"
            ? `around ${relativeToAnchor.toFixed(relativeToAnchor >= 10 ? 1 : 2)}x the cost of ${anchorLabel}`
            : "an unlisted relative cost";

    if (normalizedApiModel.includes("pro") || normalizedApiModel.includes("opus")) {
        return {
            summary: `Premium model tuned for maximum quality with ${relativeCostText}.`,
            bestFor: [
                "Complex, high-judgment questions",
                "Situations where first-answer quality matters more than cost",
                "Detailed, nuanced writing",
            ],
            notIdealFor: ["High-volume traffic with strict budgets", "Simple repetitive tasks"],
        };
    }

    if (normalizedApiModel.includes("mini") || normalizedApiModel.includes("flash") || normalizedApiModel.includes("haiku")) {
        return {
            summary: `Balanced model focused on lower cost and speed with ${relativeCostText}.`,
            bestFor: ["Everyday support Q&A", "Teams optimizing for throughput and cost", "General-purpose chats"],
            notIdealFor: ["The most difficult edge cases", "Highly nuanced, high-stakes output"],
        };
    }

    if (normalizedApiModel.includes("nano")) {
        return {
            summary: `Lowest-footprint model tuned for lightweight responses with ${relativeCostText}.`,
            bestFor: ["Simple clarifications", "Large-scale low-risk automation", "Cost-sensitive message routing"],
            notIdealFor: ["Deep reasoning tasks", "Complex multi-constraint guidance"],
        };
    }

    return {
        summary: `${model.description} Relative cost is ${relativeCostText}.`,
        bestFor: ["General support guidance", "Mixed-complexity conversations", "Teams wanting broad model coverage"],
        notIdealFor: ["Very tight cost limits if cheaper models are available", "Hardest reasoning tasks if premium models exist"],
    };
}

function formatCostOrUnknown(value: number | null): string {
    if (typeof value !== "number") {
        return "Not listed";
    }
    return formatUsd(value);
}

function formatRateOrUnresolved(model: ModelSpec, rateKind: "input" | "output"): string {
    const value = rateKind === "input" ? model.inputPerMillionUsd : model.outputPerMillionUsd;
    if (typeof value !== "number") {
        if (typeof model.pricingNotes === "string" && /unresolved pricing/i.test(model.pricingNotes)) {
            return "Unresolved";
        }
        return "Not listed";
    }

    return `${formatUsd(value)} / 1M`;
}

function formatUsd(value: number): string {
    const absolute = Math.abs(value);
    if (absolute >= 100) {
        return `$${value.toFixed(0)}`;
    }
    if (absolute >= 1) {
        return `$${value.toFixed(2)}`;
    }
    if (absolute >= 0.1) {
        return `$${value.toFixed(3)}`;
    }
    if (absolute >= 0.01) {
        return `$${value.toFixed(4)}`;
    }
    return `$${value.toFixed(5)}`;
}

function formatDateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
