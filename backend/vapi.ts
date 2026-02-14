import type { VapiToolDefinition } from "./types.js";

const VAPI_KEY = process.env.VAPI_API_KEY || "";
const BASE = "https://api.vapi.ai";

async function vapiRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" = "POST",
  body?: unknown
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_KEY}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vapi ${method} ${path} failed (${res.status}): ${err}`);
  }

  return res.json();
}

// --- Assistant management ---

export interface AssistantConfig {
  systemMessage?: string;
  maxTokens?: number;
  firstMessage?: string;
  voiceSpeed?: number;
  silenceTimeoutSeconds?: number;
  maxDurationSeconds?: number;
  messagePlan?: {
    idleMessages?: string[];
    idleMessageMaxSpokenCount?: number;
    idleTimeoutSeconds?: number;
  };
  toolIds?: string[];
  [key: string]: unknown;
}

// Extract system message from whatever format Vapi uses
function extractSystemMessage(assistant: Record<string, unknown>): string {
  // Preferred: "instructions" at root level (current Vapi format)
  if (typeof assistant.instructions === "string") return assistant.instructions;

  // Fallback: model.messages or llm.messages (older format)
  const model = assistant.model as Record<string, unknown> | undefined;
  const llm = assistant.llm as Record<string, unknown> | undefined;
  const source = model || llm;

  if (source) {
    const messages = source.messages as Array<{ role: string; content: string }> | undefined;
    if (messages?.length) {
      const sys = messages.find((m) => m.role === "system");
      if (sys) return sys.content;
    }
    if (typeof source.systemMessage === "string") return source.systemMessage;
  }

  return "";
}

export async function getAssistant(
  assistantId: string
): Promise<{ systemMessage: string; config: Record<string, unknown> }> {
  const result = (await vapiRequest(
    `/assistant/${assistantId}`,
    "GET"
  )) as Record<string, unknown>;

  return {
    systemMessage: extractSystemMessage(result),
    config: result,
  };
}

// Get the current LLM config (provider, model, etc.) for PATCH operations
async function getCurrentLlmConfig(assistantId: string): Promise<{
  field: "model" | "llm";
  provider: string;
  modelName: string;
  existing: Record<string, unknown>;
}> {
  const result = (await vapiRequest(
    `/assistant/${assistantId}`,
    "GET"
  )) as Record<string, unknown>;

  // Vapi uses either "model" or "llm" depending on version
  const model = result.model as Record<string, unknown> | undefined;
  const llm = result.llm as Record<string, unknown> | undefined;

  if (model?.provider) {
    return {
      field: "model",
      provider: model.provider as string,
      modelName: model.model as string,
      existing: model,
    };
  }
  if (llm?.provider) {
    return {
      field: "llm",
      provider: llm.provider as string,
      modelName: llm.model as string,
      existing: llm,
    };
  }

  // Fallback
  return { field: "model", provider: "openai", modelName: "gpt-4o", existing: {} };
}

export async function updateAssistant(
  assistantId: string,
  changes: AssistantConfig
): Promise<void> {
  const patch: Record<string, unknown> = {};

  // System prompt — Vapi uses "instructions" at root level
  if (changes.systemMessage !== undefined) {
    patch.instructions = changes.systemMessage;
  }

  // LLM config changes (maxTokens goes inside the llm/model object)
  if (changes.maxTokens !== undefined) {
    const llmConfig = await getCurrentLlmConfig(assistantId);
    patch[llmConfig.field] = {
      provider: llmConfig.provider,
      model: llmConfig.modelName,
      maxTokens: changes.maxTokens,
    };
  }

  // toolIds — at root level
  if (changes.toolIds !== undefined) {
    patch.toolIds = changes.toolIds;
  }

  // Voice speed — preserve existing voice config
  if (changes.voiceSpeed !== undefined) {
    const result = (await vapiRequest(`/assistant/${assistantId}`, "GET")) as Record<string, unknown>;
    const currentVoice = result.voice as Record<string, unknown> | undefined;
    patch.voice = { ...currentVoice, speed: changes.voiceSpeed };
  }

  // First message
  if (changes.firstMessage !== undefined) patch.firstMessage = changes.firstMessage;

  // Silence / duration
  if (changes.silenceTimeoutSeconds !== undefined) patch.silenceTimeoutSeconds = changes.silenceTimeoutSeconds;
  if (changes.maxDurationSeconds !== undefined) patch.maxDurationSeconds = changes.maxDurationSeconds;

  // Message plan (idle messages)
  if (changes.messagePlan !== undefined) patch.messagePlan = changes.messagePlan;

  if (Object.keys(patch).length === 0) {
    console.log(`[vapi] No changes to apply to assistant ${assistantId}`);
    return;
  }

  await vapiRequest(`/assistant/${assistantId}`, "PATCH", patch);

  const keys = Object.keys(patch);
  console.log(`[vapi] Updated assistant ${assistantId}: ${keys.join(", ")}`);
}

// Convenience wrapper
export async function updateAssistantPrompt(
  assistantId: string,
  newSystemPrompt: string
): Promise<void> {
  await updateAssistant(assistantId, { systemMessage: newSystemPrompt });
}

export async function createAssistant(
  name: string,
  systemPrompt: string,
  serverUrl: string
): Promise<string> {
  const payload = {
    name,
    instructions: systemPrompt,
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    },
    voice: {
      provider: "11labs",
      voiceId: "kdmDKE6EkgrWrrykO9Qt",
      model: "eleven_turbo_v2_5",
    },
    serverUrl,
    firstMessage:
      "Hello, this is Ruya Logistics. How can I help you with your shipment today?",
  };

  const result = (await vapiRequest("/assistant", "POST", payload)) as {
    id: string;
  };
  console.log(`[vapi] Created assistant "${name}" → ${result.id}`);
  return result.id;
}

// --- Call management ---

export async function createOutboundCall(
  assistantId: string,
  customerNumber: string,
  phoneNumberId?: string
): Promise<string> {
  const payload: Record<string, unknown> = {
    assistantId,
    customer: { number: customerNumber },
  };
  if (phoneNumberId) {
    payload.phoneNumberId = phoneNumberId;
  }

  const result = (await vapiRequest("/call/phone", "POST", payload)) as {
    id: string;
  };
  console.log(`[vapi] Outbound call created → ${result.id}`);
  return result.id;
}

export async function getCall(
  callId: string
): Promise<{
  id: string;
  status: string;
  transcript: string;
  summary?: string;
  messages?: { role: string; message: string; time: number }[];
  analysis?: Record<string, unknown>;
  endedReason?: string;
  duration?: number;
}> {
  return vapiRequest(`/call/${callId}`, "GET") as Promise<{
    id: string;
    status: string;
    transcript: string;
    summary?: string;
    messages?: { role: string; message: string; time: number }[];
    analysis?: Record<string, unknown>;
    endedReason?: string;
    duration?: number;
  }>;
}

export async function listRecentCalls(
  assistantId: string,
  limit = 5
): Promise<unknown[]> {
  return vapiRequest(
    `/call?assistantId=${assistantId}&limit=${limit}`,
    "GET"
  ) as Promise<unknown[]>;
}

// --- Tool management ---

export async function createVapiTool(
  tool: VapiToolDefinition,
  serverUrl: string
): Promise<string> {
  // Vapi expects: name/description at root, server inside function
  const payload = {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    function: {
      parameters: tool.function.parameters,
      server: { url: serverUrl },
    },
  };

  const result = (await vapiRequest("/tool", "POST", payload)) as {
    id: string;
  };
  console.log(`[vapi] Created tool "${tool.function.name}" → ${result.id}`);
  return result.id;
}

export async function addToolToAssistant(
  assistantId: string,
  toolId: string
): Promise<void> {
  const assistant = (await vapiRequest(
    `/assistant/${assistantId}`,
    "GET"
  )) as { toolIds?: string[] };

  const existingIds = assistant.toolIds || [];

  // toolIds is at root level (not inside model/llm)
  await vapiRequest(`/assistant/${assistantId}`, "PATCH", {
    toolIds: [...existingIds, toolId],
  });

  console.log(`[vapi] Added tool ${toolId} to assistant ${assistantId} (now ${existingIds.length + 1} tools)`);
}
