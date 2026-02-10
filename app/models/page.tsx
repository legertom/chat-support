import Link from "next/link";
import { redirect } from "next/navigation";
import { getDropdownModelCatalogForUser } from "@/lib/model-catalog";
import { calculateCost, DEFAULT_MODEL_ID, parseModelId, resolveModelPricingMetadata, type ModelSpec } from "@/lib/models";
import { requireDbUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const COST_SCENARIOS = [
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
] as const;

type CostScenario = (typeof COST_SCENARIOS)[number];

interface ModelCostSnapshot {
  quick: number | null;
  standard: number | null;
  deep: number | null;
}

interface ModelGuideCopy {
  summary: string;
  bestFor: string[];
  notIdealFor: string[];
}

const KNOWN_MODEL_COPY: Record<string, ModelGuideCopy> = {
  "openai:gpt-5.2-pro": {
    summary:
      "Highest-quality option in this app. Best when the answer needs careful judgment, nuance, and precision.",
    bestFor: [
      "High-stakes responses where wording accuracy matters",
      "Complex policy or workflow explanations with many constraints",
      "Requests that need polished output on the first try",
    ],
    notIdealFor: [
      "High-volume queues where cost needs to stay low",
      "Short routine questions that do not need advanced reasoning",
    ],
  },
  "openai:gpt-5.2": {
    summary: "Strong all-around model with high quality at a much lower cost than Pro.",
    bestFor: [
      "Most day-to-day support conversations",
      "Questions that need reasoning plus clear writing",
      "Teams that want strong quality without top-tier pricing",
    ],
    notIdealFor: ["The tightest budget scenarios", "Very lightweight tasks where speed and cost matter more than depth"],
  },
  "openai:gpt-5.1": {
    summary: "Reliable and capable model that balances quality and cost for broad support use.",
    bestFor: [
      "General support Q&A and troubleshooting",
      "Stable behavior for repeated workflows",
      "Teams that want predictable costs",
    ],
    notIdealFor: ["The most complex edge cases where top-tier quality is worth paying for"],
  },
  "openai:gpt-5": {
    summary: "Stable baseline GPT-5 behavior with similar economics to GPT-5.1 in this configuration.",
    bestFor: [
      "Core support answers and policy explanations",
      "Organizations that prefer consistency over latest-version changes",
      "Mixed workloads with moderate complexity",
    ],
    notIdealFor: ["Ultra-low-cost operations", "The hardest prompts where premium quality is required"],
  },
  "openai:gpt-5-mini": {
    summary: "Best price-to-quality default for many teams. Good quality while staying inexpensive.",
    bestFor: [
      "Most support chats at scale",
      "Teams optimizing cost without dropping to bare-minimum quality",
      "Fast iteration in day-to-day work",
    ],
    notIdealFor: ["Very complex, nuanced reasoning", "Premium writing quality requirements"],
  },
  "openai:gpt-5-nano": {
    summary: "Cheapest option. Best for simple tasks where speed and volume matter more than depth.",
    bestFor: [
      "Short factual lookups and simple rewrites",
      "Large-volume, low-risk workflows",
      "Cost-sensitive automation",
    ],
    notIdealFor: ["Complex multi-step reasoning", "Responses where subtle wording quality is critical"],
  },
};

export default async function ModelsPage() {
  try {
    const user = await requireDbUser();
    const modelCatalog = await getDropdownModelCatalogForUser(user.id);
    const models = sortModelsForDisplay(modelCatalog.map(resolveModelPricingForDisplay));
    const costsByModel = new Map(models.map((model) => [model.id, buildCostSnapshot(model)]));

    const cheapestPricedModel = models.find((model) => {
      const costs = costsByModel.get(model.id);
      return typeof costs?.standard === "number";
    });
    const mostExpensivePricedModel = [...models]
      .reverse()
      .find((model) => typeof costsByModel.get(model.id)?.standard === "number");
    const defaultModel = models.find((model) => model.id === DEFAULT_MODEL_ID) ?? null;
    const cheapestStandardCost = cheapestPricedModel ? costsByModel.get(cheapestPricedModel.id)?.standard ?? null : null;

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
          <h2>How To Read This</h2>
          <p>
            A model is the AI engine you choose before sending a message. Bigger models usually give better answers on hard
            tasks, but they cost more. Smaller models are cheaper and often faster, but may miss nuance.
          </p>
          <p>
            Costs below are estimates using the same token pricing that powers app billing. A token is a small chunk of text
            (roughly 3/4 of a word in normal English).
          </p>

          <div className="models-legend-grid">
            {COST_SCENARIOS.map((scenario) => (
              <article key={scenario.id} className="models-legend-card">
                <h3>{scenario.label}</h3>
                <p>{scenario.explanation}</p>
                <p className="muted">
                  {scenario.inputTokens.toLocaleString()} input tokens + {scenario.outputTokens.toLocaleString()} output tokens
                </p>
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
              <h3>Lowest Standard Cost</h3>
              <p>{cheapestPricedModel?.label ?? "Pricing unavailable"}</p>
            </article>
            <article className="models-pick-card">
              <h3>Highest Standard Cost</h3>
              <p>{mostExpensivePricedModel?.label ?? "Pricing unavailable"}</p>
            </article>
          </div>
        </section>

        <section className="panel models-costs">
          <h2>Side-By-Side Cost Comparison</h2>
          <div className="models-table-wrap">
            <table className="models-table">
              <thead>
                <tr>
                  <th>Model</th>
                  {COST_SCENARIOS.map((scenario) => (
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
          <p className="muted">Actual spend varies with prompt size, answer length, and provider-side token counting.</p>
        </section>

        <section className="models-card-grid">
          {models.map((model) => {
            const modelCosts = costsByModel.get(model.id) ?? { quick: null, standard: null, deep: null };
            const standardCost = modelCosts.standard;
            const relativeToCheapest =
              typeof standardCost === "number" && typeof cheapestStandardCost === "number" && cheapestStandardCost > 0
                ? standardCost / cheapestStandardCost
                : null;
            const guideCopy = buildGuideCopy(model, relativeToCheapest);

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
                </div>

                <p className="model-summary">{guideCopy.summary}</p>

                <div className="model-pill-row">
                  <span className="model-pill">Quick: {formatCostOrUnknown(modelCosts.quick)}</span>
                  <span className="model-pill">Standard: {formatCostOrUnknown(modelCosts.standard)}</span>
                  <span className="model-pill">Deep: {formatCostOrUnknown(modelCosts.deep)}</span>
                  <span className="model-pill">
                    100 standard replies:{" "}
                    {typeof modelCosts.standard === "number" ? formatUsd(modelCosts.standard * 100) : "Not listed"}
                  </span>
                  <span className="model-pill">
                    Relative cost:{" "}
                    {typeof relativeToCheapest === "number" ? `${relativeToCheapest.toFixed(relativeToCheapest >= 10 ? 1 : 2)}x` : "N/A"}
                  </span>
                </div>

                <div className="model-guidance-grid">
                  <section className="model-guidance">
                    <h3>Best For</h3>
                    <ul>
                      {guideCopy.bestFor.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>

                  <section className="model-guidance">
                    <h3>Not Ideal For</h3>
                    <ul>
                      {guideCopy.notIdealFor.map((item) => (
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
      </div>
    );
  } catch {
    redirect("/signin");
  }
}

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

function buildCostSnapshot(model: ModelSpec): ModelCostSnapshot {
  return {
    quick: estimateScenarioCost(model, COST_SCENARIOS[0]),
    standard: estimateScenarioCost(model, COST_SCENARIOS[1]),
    deep: estimateScenarioCost(model, COST_SCENARIOS[2]),
  };
}

function estimateScenarioCost(model: ModelSpec, scenario: CostScenario): number | null {
  const result = calculateCost(
    {
      inputTokens: scenario.inputTokens,
      outputTokens: scenario.outputTokens,
      totalTokens: scenario.inputTokens + scenario.outputTokens,
    },
    model.id,
    model
  );

  if (!result.hasPricing) {
    return null;
  }

  return result.totalCostUsd;
}

function sortModelsForDisplay(models: ModelSpec[]): ModelSpec[] {
  return [...models].sort((left, right) => {
    const leftStandardCost = estimateScenarioCost(left, COST_SCENARIOS[1]);
    const rightStandardCost = estimateScenarioCost(right, COST_SCENARIOS[1]);

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

function buildGuideCopy(model: ModelSpec, relativeToCheapest: number | null): ModelGuideCopy {
  const known = KNOWN_MODEL_COPY[model.id];
  if (known) {
    return known;
  }

  const normalizedApiModel = model.apiModel.toLowerCase();
  const relativeCostText =
    typeof relativeToCheapest === "number"
      ? `around ${relativeToCheapest.toFixed(relativeToCheapest >= 10 ? 1 : 2)}x the lowest-cost standard option`
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
