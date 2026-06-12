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

// ─── Coding Plan 硬编码模型列表 ──────────────────────────────
// 来源: https://www.volcengine.com/docs/82379/1925114
// Coding Plan 没有 /models 接口，模型列表必须硬编码
const CODING_PLAN_MODELS: any[] = [
  {
    id: "ark-code-latest",
    name: "Auto (智能调度)",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 32000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "doubao-seed-2.0-code",
    name: "Doubao Seed 2.0 Code",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "doubao-seed-2.0-pro",
    name: "Doubao Seed 2.0 Pro",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "doubao-seed-2.0-lite",
    name: "Doubao Seed 2.0 Lite",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "doubao-seed-code",
    name: "Doubao Seed Code",
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 32000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 512000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256000,
    maxTokens: 32000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "glm-5.1",
    name: "GLM 5.1",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 128000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1024000,
    maxTokens: 384000,
    compat: { ...MODEL_COMPAT },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: true,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1024000,
    maxTokens: 384000,
    compat: { ...MODEL_COMPAT },
  },
];

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

  // ─── Coding Plan 硬编码模型 ─────────────────────────────
  pi.registerProvider("volcengine-plan", {
    name: "Volcengine Coding Plan (火山引擎编程套餐)",
    baseUrl: VOLCENGINE_CODING_BASE,
    apiKey: "$VOLCENGINE_PLAN_API_KEY",
    api: "openai-completions",
    models: CODING_PLAN_MODELS,
  });
}
