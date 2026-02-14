// --- Vapi Webhook Payloads ---

export interface VapiToolCallPayload {
  message: {
    type: "tool-calls";
    toolCallList: VapiToolCall[];
    call?: { id: string; customer?: { number?: string } };
  };
}

export interface VapiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: Record<string, unknown> };
}

export interface VapiToolCallResult {
  results: { toolCallId: string; result: string }[];
}

// --- Vapi Server Messages (webhooks) ---

export interface VapiServerMessage {
  message: {
    type: string;
    call?: { id: string; assistantId?: string; customer?: { number?: string } };
    endedReason?: string;
    transcript?: string;
    summary?: string;
    messages?: { role: string; message: string }[];
    [key: string]: unknown;
  };
}

// --- Vapi API ---

export interface VapiToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
  server?: { url: string };
}

// --- Tool Registry ---

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: VapiToolDefinition["function"]["parameters"];
  handler: ToolHandler;
  createdAt: string;
  isDynamic: boolean;
}

// --- Brain ---

export interface BrainDecision {
  action: "execute_tool" | "create_tool" | "respond" | "escalate" | "update_prompt";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  response?: string;
  newTool?: {
    name: string;
    description: string;
    parameters: VapiToolDefinition["function"]["parameters"];
    handlerCode: string;
  };
  escalationReason?: string;
  newPrompt?: string;
}

// --- WhatsApp ---

export interface WhapiIncomingMessage {
  messages?: {
    id: string;
    from: string;
    text?: { body: string };
    chat_id: string;
  }[];
}
