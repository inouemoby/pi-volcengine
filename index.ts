import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const VOLCENGINE_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCENGINE_CODING_BASE = "https://ark.cn-beijing.volces.com/api/coding/v3";

// ─── Auth (same pattern as ollama-cloud) ───────────────────────
function readApiKey(provider: string): string {
  const envKey = provider === "volcengine-plan"
    ? process.env.VOLCENGINE_PLAN_API_KEY || ""
    : process.env.VOLCENGINE_API_KEY || process.env.ARK_API_KEY || "";
  if (envKey) return envKey;
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.env.USERPROFILE || process.env.HOME || ".", ".pi/agent");
    const authPath = join(agentDir, "auth.json");
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf-8"));
      return auth[provider]?.key || "";
    }
  } catch { /* ignore */ }
  return "";
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
  const generalKey = readApiKey("volcengine");
  const planKey = readApiKey("volcengine-plan");

  const placeholderModel = {
    id: "login-required",
    name: "Login required — use /login to add your API key",
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
    compat: { ...MODEL_COMPAT },
  };

  // ─── General endpoint models ─────────────────────────────
  let generalModels: any[] = [];
  if (generalKey) {
    try {
      const resp = await fetch(`${VOLCENGINE_BASE}/models`, {
        headers: { Authorization: `Bearer ${generalKey}` },
      });
      const payload = (await resp.json()) as { data: any[] };
      generalModels = buildGeneralModels(payload.data);
    } catch { /* network error — fall through */ }
  }

  pi.registerProvider("volcengine", {
    name: "Volcengine (火山引擎)",
    baseUrl: VOLCENGINE_BASE,
    apiKey: "$VOLCENGINE_API_KEY",
    api: "openai-completions",
    models: generalModels.length > 0 ? generalModels : [placeholderModel],
  });

  // ─── Coding Plan models ──────────────────────────────────
  let codingPlanModels: any[] = [];
  if (planKey) {
    try {
      const resp = await fetch(`${VOLCENGINE_BASE}/models`, {
        headers: { Authorization: `Bearer ${planKey}` },
      });
      const payload = (await resp.json()) as { data: any[] };
      const candidates = buildCodingPlanModels(payload.data);

      // Probe which models actually work on the coding endpoint
      const probes = await Promise.allSettled(
        candidates.map(async (m) => {
          try {
            const r = await fetch(`${VOLCENGINE_CODING_BASE}/chat/completions`, {
              method: "POST",
              headers: { Authorization: `Bearer ${planKey}`, "Content-Type": "application/json" },
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
    } catch { /* network error — fall through */ }
  }

  pi.registerProvider("volcengine-plan", {
    name: "Volcengine Coding Plan (火山引擎编程套餐)",
    baseUrl: VOLCENGINE_CODING_BASE,
    apiKey: "$VOLCENGINE_PLAN_API_KEY",
    api: "openai-completions",
    models: codingPlanModels.length > 0 ? codingPlanModels : [placeholderModel],
  });
}
