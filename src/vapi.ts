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
      systemMessage: systemPrompt,
    },
    voice: {
      provider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
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

export async function getAssistant(
  assistantId: string
): Promise<{ systemMessage: string; [key: string]: unknown }> {
  const result = (await vapiRequest(
    `/assistant/${assistantId}`,
    "GET"
  )) as Record<string, unknown>;
  const model = result.model as { systemMessage?: string } | undefined;
  return { ...result, systemMessage: model?.systemMessage || "" };
}

export async function updateAssistantPrompt(
  assistantId: string,
  newSystemPrompt: string
): Promise<void> {
  await vapiRequest(`/assistant/${assistantId}`, "PATCH", {
    model: { systemMessage: newSystemPrompt },
  });
  console.log(
    `[vapi] Updated assistant ${assistantId} system prompt (${newSystemPrompt.length} chars)`
  );
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

// --- Tool management (secondary feature) ---

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
  )) as { model?: { toolIds?: string[] } };

  const existingIds = assistant.model?.toolIds || [];

  await vapiRequest(`/assistant/${assistantId}`, "PATCH", {
    model: { toolIds: [...existingIds, toolId] },
  });

  console.log(`[vapi] Added tool ${toolId} to assistant ${assistantId}`);
}
