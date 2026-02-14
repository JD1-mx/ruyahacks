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

export async function getAssistant(
  assistantId: string
): Promise<{ systemMessage: string; config: Record<string, unknown> }> {
  const result = (await vapiRequest(
    `/assistant/${assistantId}`,
    "GET"
  )) as Record<string, unknown>;

  // Extract system message from model.messages array
  const model = result.model as { messages?: Array<{ role: string; content: string }> } | undefined;
  const sysMsg = model?.messages?.find((m) => m.role === "system");

  return {
    systemMessage: sysMsg?.content || "",
    config: result,
  };
}

export async function updateAssistant(
  assistantId: string,
  changes: AssistantConfig
): Promise<void> {
  const patch: Record<string, unknown> = {};

  // Model-level changes — PATCH replaces entire model object, so we must
  // spread the current model to preserve provider, model name, toolIds, etc.
  const modelPatch: Record<string, unknown> = {};
  if (changes.systemMessage !== undefined) {
    modelPatch.messages = [{ role: "system", content: changes.systemMessage }];
  }
  if (changes.maxTokens !== undefined) modelPatch.maxTokens = changes.maxTokens;
  if (changes.toolIds !== undefined) modelPatch.toolIds = changes.toolIds;
  if (Object.keys(modelPatch).length > 0) {
    const current = (await vapiRequest(`/assistant/${assistantId}`, "GET")) as Record<string, unknown>;
    const currentModel = (current.model || {}) as Record<string, unknown>;
    patch.model = { ...currentModel, ...modelPatch };
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
    model: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      messages: [{ role: "system", content: systemPrompt }],
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
  const payload = {
    type: "function",
    function: tool.function,
    server: { url: serverUrl },
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
  )) as { model?: Record<string, unknown> & { toolIds?: string[] } };

  const currentModel = assistant.model || {};
  const existingIds = currentModel.toolIds || [];

  // Spread entire model to preserve provider, messages, etc.
  await vapiRequest(`/assistant/${assistantId}`, "PATCH", {
    model: { ...currentModel, toolIds: [...existingIds, toolId] },
  });

  console.log(`[vapi] Added tool ${toolId} to assistant ${assistantId} (now ${existingIds.length + 1} tools)`);
}
