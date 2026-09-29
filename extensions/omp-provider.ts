/**
 * Nexus Gateway Dynamic Provider Extension for Pi (adapted from oh-my-hook architecture)
 * - Single root provider ID: "nexus" -> model IDs become "nexus/<provider>/<modelid>"
 * - Model display names include provider badges: "[antigravity]", "[openrouter]", "[ollama-cloud]"
 * - Dynamic enrichment from local OMP catalog (context length, thinking tiers, pricing)
 * - Snapshot disk caching for instant zero-downtime startup
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

interface OmpRawModel {
  id: string;
  owned_by?: string;
  display_name?: string;
  input_modalities?: string[];
  context_length?: number;
  max_output_tokens?: number;
}

interface OmpModelsResponse {
  data?: OmpRawModel[];
}

interface CatalogModelEntry {
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

const OMP_CATALOG_PATHS = [
  join(homedir(), "library", "repos", "oh-my-pi", "packages", "catalog", "src", "models.json"),
  join(homedir(), ".omp", "catalog", "models.json"),
  join(homedir(), ".9router", "model-catalog.json"),
];

interface IndexedCatalog {
  byProvider: Record<string, Record<string, CatalogModelEntry>>;
  bySlug: Map<string, CatalogModelEntry>;
}

let cachedOmpCatalog: IndexedCatalog | null = null;

function normalizeRawCatalog(raw: unknown): Record<string, Record<string, CatalogModelEntry>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  // Handle ~/.9router/model-catalog.json format ({ v, providers, models })
  if (
    typeof record.v === "number" &&
    record.providers &&
    typeof record.providers === "object" &&
    !Array.isArray(record.providers)
  ) {
    const providers = record.providers as Record<string, Record<string, CatalogModelEntry>>;
    const modelsMeta =
      record.models && typeof record.models === "object" && !Array.isArray(record.models)
        ? (record.models as Record<string, { vision?: boolean }>)
        : {};
    const normalized: Record<string, Record<string, CatalogModelEntry>> = {};

    for (const [provider, entries] of Object.entries(providers)) {
      if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
      normalized[provider] = {};
      for (const [modelId, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== "object") continue;
        const hasVision = modelsMeta[modelId]?.vision === true;
        normalized[provider][modelId] = {
          ...entry,
          input: entry.input ?? (hasVision ? ["text", "image"] : undefined),
        };
      }
    }
    return normalized;
  }

  // Standard oh-my-pi catalog format: Record<provider, Record<modelId, CatalogModelEntry>>
  const normalized: Record<string, Record<string, CatalogModelEntry>> = {};
  for (const [provider, entries] of Object.entries(record)) {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    normalized[provider.toLowerCase()] = entries as Record<string, CatalogModelEntry>;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function buildCatalogIndex(byProvider: Record<string, Record<string, CatalogModelEntry>>): IndexedCatalog {
  const bySlug = new Map<string, CatalogModelEntry>();

  for (const entries of Object.values(byProvider)) {
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== "object") continue;
      if (!bySlug.has(key)) {
        bySlug.set(key, entry);
      }
      const bareKey = key.split("/").pop();
      if (bareKey && !bySlug.has(bareKey)) {
        bySlug.set(bareKey, entry);
      }
    }
  }

  return { byProvider, bySlug };
}

function getOmpCatalog(): IndexedCatalog | null {
  if (cachedOmpCatalog !== null) return cachedOmpCatalog;

  for (const catalogPath of OMP_CATALOG_PATHS) {
    if (existsSync(catalogPath)) {
      try {
        const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
        const byProvider = normalizeRawCatalog(parsed);
        if (byProvider) {
          cachedOmpCatalog = buildCatalogIndex(byProvider);
          return cachedOmpCatalog;
        }
      } catch {}
    }
  }

  return null;
}

function stripModelVariantSuffix(slug: string): string {
  return slug.replace(/^~/, "").replace(/:(free|batch|extended|exacto|nitro|online)$/i, "");
}

function lookupOmpModel(rawModelId: string): CatalogModelEntry | null {
  const catalog = getOmpCatalog();
  if (!catalog) return null;

  const parts = rawModelId.split("/");
  const provider = parts[0].toLowerCase();
  const modelSlug = parts.slice(1).join("/");
  const cleanModelSlug = stripModelVariantSuffix(modelSlug);
  const bareSlug = parts[parts.length - 1];
  const cleanBareSlug = stripModelVariantSuffix(bareSlug);

  // 1. Direct provider + modelSlug / bareSlug lookup
  const providerEntries = catalog.byProvider[provider];
  if (providerEntries) {
    const direct =
      providerEntries[modelSlug] ??
      providerEntries[cleanModelSlug] ??
      providerEntries[bareSlug] ??
      providerEntries[cleanBareSlug];
    if (direct) return direct;
  }

  // 2. O(1) pre-indexed slug lookup across all catalog providers
  return (
    catalog.bySlug.get(modelSlug) ??
    catalog.bySlug.get(cleanModelSlug) ??
    catalog.bySlug.get(bareSlug) ??
    catalog.bySlug.get(cleanBareSlug) ??
    null
  );
}

function resolveProviderBadge(rawId: string, ownedBy?: string): string {
  const owner = (ownedBy || rawId.split("/")[0] || "nexus").toLowerCase();

  switch (owner) {
    case "google-antigravity":
    case "antigravity":
      return "antigravity";
    case "openrouter":
      return "openrouter";
    case "opencode-zen":
    case "zen":
      return "opencode-zen";
    case "ollama-cloud":
    case "ollama":
      return "ollama-cloud";
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "deepseek":
      return "deepseek";
    case "google":
      return "google";
    default:
      return owner.replace(/[^a-z0-9_-]/g, "");
  }
}

function formatModelDisplayName(rawId: string, catalogName?: string, ownedBy?: string): string {
  const badge = resolveProviderBadge(rawId, ownedBy);
  const parts = rawId.split("/");
  const modelPart = parts[parts.length - 1];

  if (catalogName && typeof catalogName === "string" && catalogName.trim()) {
    return `${catalogName.trim()} [${badge}]`;
  }

  // Clean up model name
  let name = modelPart
    .replace(/[-_]/g, " ")
    .replace(/\b(\w)/g, (c) => c.toUpperCase());

  name = name
    .replace(/\bGpt\b/gi, "GPT")
    .replace(/\bClaude\b/gi, "Claude")
    .replace(/\bGemini\b/gi, "Gemini")
    .replace(/\bDeepseek\b/gi, "DeepSeek")
    .replace(/\bQwen\b/gi, "Qwen")
    .replace(/\bQwq\b/gi, "QwQ")
    .replace(/\bKimi\b/gi, "Kimi")
    .replace(/\bGlm\b/gi, "GLM")
    .replace(/\bMistral\b/gi, "Mistral")
    .replace(/\bCodestral\b/gi, "Codestral")
    .replace(/\bMinimax\b/gi, "MiniMax")
    .replace(/\bGrok\b/gi, "Grok")
    .replace(/\bLlama\b/gi, "Llama")
    .replace(/\bNemotron\b/gi, "Nemotron")
    .replace(/\bErnie\b/gi, "Ernie")
    .replace(/\bSolar\b/gi, "Solar")
    .replace(/\bPhi\b/gi, "Phi");

  return `${name} [${badge}]`;
}

function isReasoningModel(rawId: string): boolean {
  const lower = rawId.toLowerCase();
  if (/(^|[/-_])(r1|o1|o3|o4|qwq)([/-_:]|$)/.test(lower)) {
    return true;
  }
  return (
    lower.includes("thinking") ||
    lower.includes("reasoner") ||
    lower.includes("opus") ||
    lower.includes("sonnet") ||
    lower.includes("gemini-2.5") ||
    lower.includes("gemini-3") ||
    lower.includes("gpt-5") ||
    lower.includes("gpt-6") ||
    lower.includes("grok-3-mini") ||
    lower.includes("grok-4") ||
    lower.includes("qwen3") ||
    lower.includes("glm-4.5") ||
    lower.includes("glm-4.6") ||
    lower.includes("glm-4.7") ||
    lower.includes("glm-5") ||
    lower.includes("kimi-k2") ||
    lower.includes("deepseek-v3.2") ||
    lower.includes("minimax-m2")
  );
}

function getCachePath(): string {
  const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache", "pichamber");
  if (!existsSync(cacheDir)) {
    try {
      mkdirSync(cacheDir, { recursive: true });
    } catch {}
  }
  return join(cacheDir, "nexus-models-snapshot.json");
}

async function fetchGatewayModels(url: string, timeoutMs: number): Promise<OmpRawModel[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const payload = (await res.json()) as OmpModelsResponse;
    if (Array.isArray(payload?.data) && payload.data.length > 0) {
      return payload.data;
    }
  } catch {
    // Endpoint unreachable or timed out
  }
  return null;
}

async function probeAndRegisterModels(pi: ExtensionAPI): Promise<number> {
  let targetBaseUrl = "http://127.0.0.1:4000/v1";
  let rawData: OmpRawModel[] = [];
  const cachePath = getCachePath();

  // 1. Probe NexusRoute (:4010) in a single request
  const nexusModels = await fetchGatewayModels("http://127.0.0.1:4010/v1/models", 1500);
  if (nexusModels) {
    targetBaseUrl = "http://127.0.0.1:4010/v1";
    rawData = nexusModels;
  } else {
    // 2. Fallback to direct OMP Gateway (:4000)
    const ompModels = await fetchGatewayModels("http://127.0.0.1:4000/v1/models", 3500);
    if (ompModels) {
      targetBaseUrl = "http://127.0.0.1:4000/v1";
      rawData = ompModels;
    }
  }

  // Persist fresh gateway snapshot or fall back to cached disk snapshot
  if (rawData.length > 0) {
    try {
      writeFileSync(cachePath, JSON.stringify(rawData, null, 2), "utf8");
    } catch {}
  } else if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, "utf8"));
      if (Array.isArray(cached)) {
        rawData = cached;
      }
    } catch {}
  }

  if (rawData.length === 0) {
    return 0;
  }

  // Filter out non-chat models
  const chatModels = rawData.filter((m) => {
    if (!m.id || typeof m.id !== "string") return false;
    const lower = m.id.toLowerCase();
    return (
      !lower.includes("embedding") &&
      !lower.includes("moderation") &&
      !lower.includes("rerank") &&
      !lower.includes("tts") &&
      !lower.includes("whisper") &&
      !lower.includes("dall-e") &&
      !lower.includes("flux")
    );
  });

  const models: ProviderModelConfig[] = chatModels.map((m) => {
    const catalog = lookupOmpModel(m.id);

    const inputs: Array<"text" | "image"> =
      (Array.isArray(m.input_modalities) && m.input_modalities.includes("image")) ||
      (Array.isArray(catalog?.input) && catalog.input.includes("image"))
        ? ["text", "image"]
        : ["text"];

    const reasoning = catalog?.reasoning !== undefined ? Boolean(catalog.reasoning) : isReasoningModel(m.id);

    const contextWindow =
      catalog?.contextWindow ||
      (typeof m.context_length === "number" && m.context_length > 0 ? m.context_length : 128000);

    const maxTokens =
      catalog?.maxTokens ||
      (typeof m.max_output_tokens === "number" && m.max_output_tokens > 0 ? m.max_output_tokens : 8192);

    const cost = catalog?.cost
      ? {
          input: catalog.cost.input ?? 0,
          output: catalog.cost.output ?? 0,
          cacheRead: catalog.cost.cacheRead ?? 0,
          cacheWrite: catalog.cost.cacheWrite ?? 0,
        }
      : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const displayName = formatModelDisplayName(m.id, catalog?.name || m.display_name, m.owned_by);

    return {
      id: m.id,
      name: displayName,
      reasoning,
      input: inputs,
      cost,
      contextWindow,
      maxTokens,
    };
  });

  // Register unified single "nexus" provider
  // Full model ID in Pi / PiChamber: "nexus/<provider>/<modelid>"
  pi.registerProvider("nexus", {
    name: "Nexus Gateway",
    baseUrl: targetBaseUrl,
    apiKey: "omp",
    api: "openai-completions",
    headers: {
      "x-client-app": "pi",
    },
    models,
  });

  return models.length;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await probeAndRegisterModels(pi);

  pi.registerCommand("nexus-reload", {
    description: "Force re-probe gateways and refresh Nexus model catalog",
    handler: async (_args, ctx) => {
      cachedOmpCatalog = null;
      const count = await probeAndRegisterModels(pi);
      if (ctx.hasUI) {
        ctx.ui.notify(`Nexus catalog reloaded: ${count} models available.`, "info");
      }
    },
  });
}
