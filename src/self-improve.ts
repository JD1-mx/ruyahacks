import Anthropic from "@anthropic-ai/sdk";
import {
  getAssistant,
  updateAssistant,
  getCall,
  createOutboundCall,
  type AssistantConfig,
} from "./vapi.js";
import { notifyOperator } from "./integrations.js";
import { createAndRegisterTool, getAllTools } from "./tools.js";

const client = new Anthropic();

// --- Improvement history (in-memory) ---

export interface ImprovementRecord {
  callId: string;
  customerNumber?: string;
  timestamp: string;
  failures: string[];
  changes: string[];
  toolsCreated: string[];
  configBefore: Record<string, unknown>;
  configAfter: AssistantConfig;
  callbackTriggered: boolean;
}

const history: ImprovementRecord[] = [];

export function getImprovementHistory(): ImprovementRecord[] {
  return history;
}

// --- The configurable parameters the AI can tune ---

const TUNABLE_PARAMETERS = `
You can modify ANY of these assistant parameters. Each one fixes specific failure modes:

1. "systemMessage" (string) — The core system prompt / instructions
   FIXES: Wrong answers, missing domain knowledge, bad tone, no confirmation protocols,
   not spelling out numbers, not clarifying container sizes (20ft vs 40ft), not repeating
   booking references, missing escalation behavior, lack of structured data collection.

2. "maxTokens" (number) — Max tokens the LLM can generate per response (current: 250)
   FIXES: Responses getting cut off mid-sentence, incomplete answers, agent stopping
   abruptly. Increase to 400-500 if responses are truncated.

3. "voiceSpeed" (number, 0.5 to 2.0) — How fast the voice speaks (current: 1.0)
   FIXES: Caller saying "slow down", "what?", "can you repeat that?", or numbers being
   misheard because spoken too fast. Decrease to 0.8-0.9 for number-heavy conversations.

4. "firstMessage" (string) — The greeting when the call starts
   FIXES: Caller confused about who they're talking to, no context set, caller immediately
   asking "who is this?". Should identify company, purpose, and invite the request.

5. "silenceTimeoutSeconds" (number) — How long to wait during silence before acting
   FIXES: Agent hanging up too fast when caller is looking up information (container numbers,
   booking refs). Increase to 15-30s if callers need time to find details.

6. "maxDurationSeconds" (number) — Maximum call length
   FIXES: Complex logistics queries getting cut off. Set to 600-900 for detailed shipment inquiries.

7. "messagePlan.idleMessages" (string[]) — Messages spoken when caller is silent
   FIXES: Awkward silence, caller unsure if agent is still there. Add helpful prompts like
   "Take your time, I'm here when you're ready" or "Would you like me to repeat that?"

8. "messagePlan.idleTimeoutSeconds" (number) — Seconds before idle message plays
   FIXES: Agent either jumping in too soon (annoying) or waiting too long (caller hangs up).
   Set to 5-8 seconds.

9. "messagePlan.idleMessageMaxSpokenCount" (number) — How many idle messages before stopping
   FIXES: Agent repeating idle messages endlessly. Set to 2-3.
`;

// --- What the AI knows about tool creation ---

const TOOL_CREATION_HINTS = `
TOOL CREATION — You are a self-improving agent. If the conversation failed because you lacked
a capability (e.g., couldn't send a WhatsApp message, couldn't look up data, couldn't trigger
a workflow), you should CREATE the missing tool.

You have access to these integration platforms to build tools:
- Vapi: For voice-related tools. Tools you create here become available in future calls.
  Your server exposes tool handlers at the /vapi/tool-calls webhook.
- n8n: For workflow orchestration — email sending, webhook triggers, multi-step automations.
  You can trigger n8n workflows via HTTP webhooks.
- Whapi: For WhatsApp messaging. You can send messages to customers or operators.

When you identify a missing tool, provide a full spec:
{
  "name": "snake_case_tool_name",
  "description": "What it does",
  "parameters": {
    "type": "object",
    "properties": { "param": { "type": "string", "description": "..." } },
    "required": ["param"]
  },
  "handlerCode": "JS code that runs in async context with access to ctx.sendWhatsApp(phone, msg), ctx.notifyOperator(msg), ctx.triggerN8nWorkflow(data), ctx.fetch(url, opts). MUST return a string."
}

If you need an API key or credential you don't have, flag it as a "resourceRequest" — the system
will ask the operator via WhatsApp to provide it.

IMPORTANT: Don't be afraid to create tools. That IS the point. If you see the caller needed
something and no tool existed for it, BUILD IT.
`;

// --- Core: Full self-improvement pipeline ---

export async function analyzeAndImprove(
  callId: string,
  assistantId: string,
  customerNumber?: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===================================`);
  console.log(`[self-improve]   SELF-IMPROVEMENT PIPELINE START`);
  console.log(`[self-improve] ===================================`);
  console.log(`[self-improve] Call: ${callId}`);
  console.log(`[self-improve] Customer: ${customerNumber || "unknown"}`);

  // 1. Get transcript + current config
  const call = await getCall(callId);
  console.log(`[self-improve] Status: ${call.status}, ended: ${call.endedReason}`);
  console.log(`[self-improve] Transcript: ${call.transcript?.length || 0} chars`);

  const assistant = await getAssistant(assistantId);
  const existingTools = getAllTools();

  // 2. Analyze with Claude
  const analysis = await analyzeTranscript(
    call.transcript,
    assistant.systemMessage,
    assistant.config,
    existingTools.map((t) => ({ name: t.name, description: t.description }))
  );

  // 3. Create any missing tools
  const toolsCreated: string[] = [];
  if (analysis.newTools?.length) {
    for (const toolSpec of analysis.newTools) {
      try {
        console.log(`[self-improve] Creating tool: "${toolSpec.name}"`);
        await createAndRegisterTool(toolSpec);
        toolsCreated.push(toolSpec.name);
      } catch (err) {
        console.error(`[self-improve] Failed to create tool "${toolSpec.name}":`, err);
      }
    }
  }

  // 4. Request missing resources from operator
  if (analysis.resourceRequests?.length) {
    for (const req of analysis.resourceRequests) {
      await notifyOperator(
        `🔑 RESOURCE REQUEST: ${req}\n\nI identified this as needed to handle future calls. Please provide it or reply with instructions.`
      );
      console.log(`[self-improve] Requested resource: ${req}`);
    }
  }

  // 5. Update assistant config + prompt
  await updateAssistant(assistantId, analysis.configChanges);

  // 6. Log it
  const record: ImprovementRecord = {
    callId,
    customerNumber,
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    toolsCreated,
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
    callbackTriggered: false,
  };

  history.push(record);

  // 7. Notify operator
  console.log(`[self-improve] --- Results ---`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));
  toolsCreated.forEach((t) => console.log(`   🔧 Tool created: ${t}`));

  await notifyOperator(
    [
      `🧠 Self-improvement complete (call ${callId})`,
      ``,
      `Failures found:`,
      ...analysis.failures.map((f) => `  ❌ ${f}`),
      ``,
      `Changes applied:`,
      ...analysis.changes.map((c) => `  ✅ ${c}`),
      ...(toolsCreated.length
        ? [``, `Tools created:`, ...toolsCreated.map((t) => `  🔧 ${t}`)]
        : []),
      ``,
      customerNumber
        ? `Calling customer back now...`
        : `No customer number — skipping callback.`,
    ].join("\n")
  );

  // 8. Auto-callback to customer with improved agent
  if (customerNumber) {
    console.log(`[self-improve] Triggering callback to ${customerNumber}...`);

    // Brief delay so Vapi assistant config propagates
    await new Promise((resolve) => setTimeout(resolve, 3000));

    try {
      const callbackId = await createOutboundCall(assistantId, customerNumber);
      record.callbackTriggered = true;
      console.log(`[self-improve] Callback initiated: ${callbackId}`);
    } catch (err) {
      console.error(`[self-improve] Callback failed:`, err);
      await notifyOperator(
        `⚠️ Failed to call customer back at ${customerNumber}: ${(err as Error).message}`
      );
    }
  }

  console.log(`[self-improve] ===================================`);
  console.log(`[self-improve]   PIPELINE COMPLETE`);
  console.log(`[self-improve] ===================================\n`);

  return record;
}

// --- Transcript analysis ---

interface AnalysisResult {
  failures: string[];
  changes: string[];
  configChanges: AssistantConfig;
  newTools?: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
    handlerCode: string;
  }[];
  resourceRequests?: string[];
}

async function analyzeTranscript(
  transcript: string,
  currentPrompt: string,
  currentConfig: Record<string, unknown>,
  existingTools: { name: string; description: string }[]
): Promise<AnalysisResult> {
  const toolList = existingTools.length
    ? existingTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    : "NO TOOLS CONFIGURED";

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: `You are a self-improving AI system for voice assistants. You analyze failed call transcripts and:
1. Improve the prompt and config
2. CREATE missing tools
3. Request resources you need but don't have

You work for Ruya Logistics, a freight forwarding company in Dubai that moves containers from Jebel Ali port to warehouses.

${TUNABLE_PARAMETERS}

${TOOL_CREATION_HINTS}

EXISTING TOOLS:
${toolList}

Your job:
1. Read the transcript and identify EVERY specific failure
2. For each failure, determine: is it a prompt/config issue OR a missing tool?
3. Produce the improved config AND any new tools needed
4. If you need API keys or credentials you don't have, list them as resourceRequests

IMPORTANT — for the improved systemMessage, include a note that the agent should begin callbacks
with: "Hi, this is Ruya Logistics calling back. I apologize for the issues on our last call.
I've checked with the team and I now have the right tools to help you. How can I assist?"

Respond with ONLY valid JSON:
{
  "failures": [
    "Failure description → FIX: what parameter or tool fixes it"
  ],
  "changes": [
    "Human-readable description of each change applied"
  ],
  "configChanges": {
    "systemMessage": "the full improved system prompt",
    "maxTokens": 500,
    "voiceSpeed": 0.85,
    "firstMessage": "improved greeting",
    "silenceTimeoutSeconds": 20,
    "messagePlan": {
      "idleMessages": ["Take your time, I'm still here."],
      "idleTimeoutSeconds": 7,
      "idleMessageMaxSpokenCount": 2
    }
  },
  "newTools": [
    {
      "name": "tool_name",
      "description": "what it does",
      "parameters": { "type": "object", "properties": {}, "required": [] },
      "handlerCode": "return 'result'"
    }
  ],
  "resourceRequests": [
    "Need Whapi API key to send WhatsApp messages to customers",
    "Need n8n webhook URL to trigger email workflows"
  ]
}

Only include configChanges fields that need changing. Always include systemMessage.
Only include newTools if tools are actually missing.
Only include resourceRequests if you truly need credentials you don't have access to.`,
    messages: [
      {
        role: "user",
        content: `CURRENT SYSTEM PROMPT:\n${currentPrompt}\n\nCURRENT ASSISTANT CONFIG:\n${JSON.stringify(currentConfig, null, 2)}\n\nCALL TRANSCRIPT:\n${transcript}\n\nAnalyze ALL failures. Improve config, create missing tools, request missing resources.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("[self-improve] Failed to parse analysis:", text);
    return {
      failures: ["Could not parse analysis output"],
      changes: ["No changes made — parse error"],
      configChanges: { systemMessage: currentPrompt },
    };
  }
}

// --- Manual trigger with raw transcript ---

export async function analyzeFromTranscript(
  transcript: string,
  assistantId: string,
  customerNumber?: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===== MANUAL SELF-IMPROVEMENT =====`);

  const assistant = await getAssistant(assistantId);
  const existingTools = getAllTools();

  const analysis = await analyzeTranscript(
    transcript,
    assistant.systemMessage,
    assistant.config,
    existingTools.map((t) => ({ name: t.name, description: t.description }))
  );

  // Create tools
  const toolsCreated: string[] = [];
  if (analysis.newTools?.length) {
    for (const toolSpec of analysis.newTools) {
      try {
        await createAndRegisterTool(toolSpec);
        toolsCreated.push(toolSpec.name);
      } catch (err) {
        console.error(`[self-improve] Failed to create tool "${toolSpec.name}":`, err);
      }
    }
  }

  // Resource requests
  if (analysis.resourceRequests?.length) {
    for (const req of analysis.resourceRequests) {
      await notifyOperator(`🔑 RESOURCE REQUEST: ${req}`);
    }
  }

  await updateAssistant(assistantId, analysis.configChanges);

  const record: ImprovementRecord = {
    callId: "manual",
    customerNumber,
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    toolsCreated,
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
    callbackTriggered: false,
  };

  history.push(record);

  console.log(`[self-improve] Failures:`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  console.log(`[self-improve] Changes:`);
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));

  await notifyOperator(
    [
      `🧠 Manual self-improvement complete`,
      ...analysis.failures.map((f) => `  ❌ ${f}`),
      ...analysis.changes.map((c) => `  ✅ ${c}`),
      ...(toolsCreated.length ? toolsCreated.map((t) => `  🔧 ${t}`) : []),
    ].join("\n")
  );

  // Auto-callback
  if (customerNumber) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      await createOutboundCall(assistantId, customerNumber);
      record.callbackTriggered = true;
    } catch (err) {
      console.error(`[self-improve] Callback failed:`, err);
    }
  }

  console.log(`[self-improve] ===== MANUAL IMPROVEMENT COMPLETE =====\n`);
  return record;
}
