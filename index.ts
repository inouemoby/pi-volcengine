import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const VOLCENGINE_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCENGINE_CODING_BASE = "https://ark.cn-beijing.volces.com/api/coding/v3";
const AUTH_KEY = "volcengine";

// ─── Auth helpers (auth.json, same as ollama-cloud) ────────────
function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(process.env.HOME || process.env.USERPROFILE || ".", ".pi/agent");
}

function readAuth(): Record<string, any> {
  try {
    const p = join(getAgentDir(), "auth.json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return {}; }
}

function writeAuth(data: Record<string, any>) {
  const p = join(getAgentDir(), "auth.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function readApiKey(): string {
  // env var > auth.json
  const env = process.env.VOLCENGINE_API_KEY || process.env.ARK_API_KEY || "";
  if (env) return env;
  return readAuth()[AUTH_KEY]?.key || "";
}

function saveApiKey(key: string) {
  const auth = readAuth();
  auth[AUTH_KEY] = { ...(auth[AUTH_KEY] || {}), key };
  writeAuth(auth);
}

function clearApiKey() {
  const auth = readAuth();
  auth[AUTH_KEY] = { ...(auth[AUTH_KEY] || {}), key: "" };
  writeAuth(auth);
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

const MODEL_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  thinkingFormat: "deepseek" as const,
};

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
    compat: { ...MODEL_COMPAT },
  };
}

function buildGeneralModels(data: any[]): any[] {
  return data
    .filter((m) => m.status === undefined || m.status !== "Shutdown")
    .filter(isCodingModel)
    .map((m) => buildOneModel(m, m.id));
}

function buildCodingPlanModels(data: any[]): any[] {
  const filtered = data
    .filter((m) => m.status === undefined || m.status !== "Shutdown")
    .filter(isCodingModel);

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

// ─── Main ─────────────────────────────────────────────────────
export default async function (pi: ExtensionAPI) {
  const apiKey = readApiKey();

  const placeholderModel = {
    id: "login-required",
    name: "Login required — use /volcengine-login to add your API key",
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
    compat: { ...MODEL_COMPAT },
  };

  if (!apiKey) {
    pi.registerProvider("volcengine", {
      name: "Volcengine (火山引擎)",
      baseUrl: VOLCENGINE_BASE,
      apiKey: "$VOLCENGINE_API_KEY",
      api: "openai-completions",
      models: [placeholderModel],
    });
    pi.registerProvider("volcengine-plan", {
      name: "Volcengine Coding Plan (火山引擎编程套餐)",
      baseUrl: VOLCENGINE_CODING_BASE,
      apiKey: "$VOLCENGINE_API_KEY",
      api: "openai-completions",
      models: [placeholderModel],
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

  // For coding plan, probe which models actually work
  let codingPlanModels: any[] = [];
  if (rawModels.length > 0) {
    const candidates = buildCodingPlanModels(rawModels);
    const probes = await Promise.allSettled(
      candidates.map(async (m) => {
        try {
          const r = await fetch(`${VOLCENGINE_CODING_BASE}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: m.id, messages: [{ role: "user", content: "ok" }], max_tokens: 1 }),
          });
          const d = await r.json();
          return d.choices ? m : null;
        } catch { return null; }
      })
    );
    codingPlanModels = probes
      .filter((p): p is PromiseFulfilledResult<any> => p.status === "fulfilled" && p.value !== null)
      .map((p) => p.value);
  }
  codingPlanModels = codingPlanModels.length > 0 ? codingPlanModels : [placeholderModel];

  pi.registerProvider("volcengine", {
    name: "Volcengine (火山引擎)",
    baseUrl: VOLCENGINE_BASE,
    apiKey,
    api: "openai-completions",
    models: generalModels,
  });

  pi.registerProvider("volcengine-plan", {
    name: "Volcengine Coding Plan (火山引擎编程套餐)",
    baseUrl: VOLCENGINE_CODING_BASE,
    apiKey,
    api: "openai-completions",
    models: codingPlanModels,
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
      saveApiKey(key);
      ctx.ui.notify("✓ Volcengine API Key saved! Run /reload to load models.", "success");
    },
  });

  // ── /volcengine-logout ───────────────────────────────────
  pi.registerCommand("volcengine-logout", {
    description: "Clear Volcengine API Key",
    handler: async (_args, ctx) => {
      clearApiKey();
      ctx.ui.notify("✓ Volcengine API Key cleared. Run /reload to apply.", "success");
    },
  });
}
