import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const VOLCENGINE_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCENGINE_CODING_BASE = "https://ark.cn-beijing.volces.com/api/coding/v3";
const SETTINGS_KEY = "volcengine";

// ─── Settings helpers ─────────────────────────────────────────
function getSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return resolve(home, ".pi", "agent", "settings.json");
}

function readSettings(): Record<string, any> {
  try {
    const path = getSettingsPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch { return {}; }
}

function writeSettings(data: Record<string, any>) {
  const path = getSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Model filtering ──────────────────────────────────────────
const CODING_TASK_TYPES = new Set(["TextGeneration", "Chat"]);
const SKIP_NAME_PATTERNS = [
  /embedding/i, /seedream/i, /seedance/i, /seededit/i, /seed3d/i,
  /hitem3d/i, /hyper3d/i, /translation/i, /character/i, /browsing/i,
  /smart-router/i, /ui-tars/i, /seaweed/i, /wan2/i,
];

function isCodingModel(m: any): boolean {
  const id = (m.id || "").toLowerCase();
  const name = (m.name || "").toLowerCase();
  const tasks: string[] = m.task_type || [];
  if (!tasks.some(t => CODING_TASK_TYPES.has(t))) return false;
  for (const pat of SKIP_NAME_PATTERNS) {
    if (pat.test(id) || pat.test(name)) return false;
  }
  return true;
}

// Build models for general endpoint (uses m.id as model id)
function buildGeneralModels(data: any[]): any[] {
  return data
    .filter((m) => m.status === undefined || m.status !== "Shutdown")
    .filter(isCodingModel)
    .map((m) => buildOneModel(m, m.id));
}

// Build models for coding plan endpoint (uses m.name as model id, deduplicated)
function buildCodingPlanModels(data: any[]): any[] {
  const filtered = data
    .filter((m) => m.status === undefined || m.status !== "Shutdown")
    .filter(isCodingModel);

  // Deduplicate by name — multiple versions share the same name
  const seen = new Set<string>();
  const unique: any[] = [];
  for (const m of filtered) {
    const planId = m.name || m.id;
    if (!seen.has(planId)) {
      seen.add(planId);
      unique.push(m);
    }
  }

  return unique.map((m) => buildOneModel(m, m.name || m.id));
}

function buildOneModel(m: any, modelId: string) {
  const limits = m.token_limits || {};
  const inputMods: string[] = m.modalities?.input_modalities || ["text"];
  const hasVision = inputMods.includes("image");
  const hasReasoning = (limits.max_reasoning_token_length || 0) > 0;

  return {
    id: modelId,
    name: m.name || m.id,
    reasoning: hasReasoning,
    input: hasVision
      ? (["text", "image"] as ("text" | "image")[])
      : (["text"] as ("text" | "image")[]),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: limits.context_window || 128000,
    maxTokens: Math.min(limits.max_output_token_length || 16384, 65536),
  };
}

// ─── Main ─────────────────────────────────────────────────────
export default async function (pi: ExtensionAPI) {
  // Resolve API key: env var > settings.json
  let apiKey = process.env.VOLCENGINE_API_KEY || process.env.ARK_API_KEY || "";
  if (!apiKey) {
    const cfg = readSettings()[SETTINGS_KEY];
    if (cfg?.apiKey) apiKey = cfg.apiKey;
  }

  const placeholderModel = {
    id: "login-required",
    name: "Login required — use /volcengine-login to add your API key",
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  };

  const resolvedApiKey = apiKey || "$VOLCENGINE_API_KEY";
  const compat = {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    thinkingFormat: "deepseek" as const,
  };

  if (!apiKey) {
    // No key — register both providers with placeholder
    pi.registerProvider("volcengine", {
      name: "Volcengine (火山引擎)",
      baseUrl: VOLCENGINE_BASE,
      apiKey: resolvedApiKey,
      api: "openai-completions",
      models: [placeholderModel],
      compat,
    });
    pi.registerProvider("volcengine-plan", {
      name: "Volcengine Coding Plan (火山引擎编程套餐)",
      baseUrl: VOLCENGINE_CODING_BASE,
      apiKey: resolvedApiKey,
      api: "openai-completions",
      models: [placeholderModel],
      compat,
    });
    return;
  }

  // Fetch model list
  let rawModels: any[] = [];
  try {
    const resp = await fetch(`${VOLCENGINE_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = (await resp.json()) as { data: any[] };
    rawModels = payload.data;
  } catch {
    // Network error — fall through to placeholder
  }

  const generalModels = rawModels.length > 0 ? buildGeneralModels(rawModels) : [placeholderModel];
  const codingPlanModels = rawModels.length > 0 ? buildCodingPlanModels(rawModels) : [placeholderModel];

  // Register volcengine (general endpoint — uses model id like doubao-seed-2-0-pro-260215)
  pi.registerProvider("volcengine", {
    name: "Volcengine (火山引擎)",
    baseUrl: VOLCENGINE_BASE,
    apiKey: resolvedApiKey,
    api: "openai-completions",
    models: generalModels,
    compat,
  });

  // Register volcengine-plan (coding plan — uses model name like doubao-seed-2-0-pro)
  pi.registerProvider("volcengine-plan", {
    name: "Volcengine Coding Plan (火山引擎编程套餐)",
    baseUrl: VOLCENGINE_CODING_BASE,
    apiKey: resolvedApiKey,
    api: "openai-completions",
    models: codingPlanModels,
    compat,
  });

  // ── /volcengine-login ────────────────────────────────────
  pi.registerCommand("volcengine-login", {
    description: "Set Volcengine API Key (interactive)",
    handler: async (args, ctx) => {
      const t = (args ?? "").trim();
      let key: string;
      if (t) {
        key = t;
      } else {
        const input = await ctx.ui.input("Volcengine Login — API Key (ark-...):");
        if (!input?.trim()) return ctx.ui.notify("Cancelled.", "warning");
        key = input.trim();
      }
      const settings = readSettings();
      settings[SETTINGS_KEY] = { ...(settings[SETTINGS_KEY] || {}), apiKey: key };
      writeSettings(settings);
      ctx.ui.notify("✓ Volcengine API Key saved! Run /reload to load models.", "success");
    },
  });

  // ── /volcengine-logout ───────────────────────────────────
  pi.registerCommand("volcengine-logout", {
    description: "Clear Volcengine API Key",
    handler: async (_args, ctx) => {
      const settings = readSettings();
      settings[SETTINGS_KEY] = { ...(settings[SETTINGS_KEY] || {}), apiKey: "" };
      writeSettings(settings);
      ctx.ui.notify("✓ Volcengine API Key cleared. Run /reload to apply.", "success");
    },
  });
}
