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
import { createCustomWorkflow, isN8nConfigured, listWorkflows, getWorkflow } from "./n8n.js";

const client = new Anthropic();

// --- Improvement history (in-memory) ---

export interface PipelineStep {
  step: string;
  status: "ok" | "error" | "skipped";
  detail: string;
  timestamp: string;
}

export interface ImprovementRecord {
  callId: string;
  customerNumber?: string;
  timestamp: string;
  failures: string[];
  changes: string[];
  toolsCreated: string[];
  workflowsCreated: string[];
  configBefore: Record<string, unknown>;
  configAfter: AssistantConfig;
  callbackTriggered: boolean;
  rawAnalysis?: string;
  pipelineLog: PipelineStep[];
}

const history: ImprovementRecord[] = [];

export function getImprovementHistory(): ImprovementRecord[] {
  return history;
}

export function clearHistory() {
  history.length = 0;
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
a capability, you MUST create it. That is your entire purpose.

You have TWO ways to create capabilities:

== 1. VAPI TOOLS (callable by the voice assistant during a call) ==
Tool spec format:
{
  "name": "snake_case_tool_name",
  "description": "What it does",
  "parameters": {
    "type": "object",
    "properties": { "param": { "type": "string", "description": "..." } },
    "required": ["param"]
  },
  "handlerCode": "JS code with access to ctx.sendWhatsApp(phone, msg), ctx.notifyOperator(msg), ctx.triggerN8nWorkflow(data), ctx.fetch(url, opts). MUST return a string."
}

== 2. N8N WORKFLOWS (multi-step automations deployed to n8n) ==
You can create workflows on n8n that get a webhook URL you can call from tools.
Workflow spec format:
{
  "type": "custom",
  "name": "Workflow Name",
  "webhookPath": "unique-path-name",
  "steps": [
    {
      "name": "Step Name",
      "method": "POST",
      "url": "https://api.example.com/endpoint",
      "headers": { "Authorization": "Bearer token" },
      "bodyTemplate": "={ \\"key\\": \\"{{ $json.body.value }}\\" }"
    }
  ]
}

== HINTS ==
- If WhatsApp messaging is needed, you should prefer Whapi (https://gate.whapi.cloud).
  Research the Whapi API for how to send messages. Look at the EXISTING WORKFLOWS below
  for any WhatsApp integrations already built in this n8n account — use those as reference
  for how it's been done before. Pick the best pattern you find.
- For email, look at existing n8n workflows for email patterns.
- For data lookups, create a Vapi tool directly with ctx.fetch().
- You can chain: create an n8n workflow first, then a Vapi tool that calls its webhook.

If you need an API key or credential you don't have, add it to "resourceRequests".

IMPORTANT: Don't be afraid to create tools and workflows. Figure it out. That IS the point.
`;

// --- Core: Full self-improvement pipeline ---

function logStep(log: PipelineStep[], step: string, status: PipelineStep["status"], detail: string) {
  const entry: PipelineStep = { step, status, detail, timestamp: new Date().toISOString() };
  log.push(entry);
  const icon = status === "ok" ? "✅" : status === "error" ? "❌" : "⏭️";
  console.log(`[self-improve] ${icon} ${step}: ${detail}`);
}

export async function analyzeAndImprove(
  callId: string,
  assistantId: string,
  customerNumber?: string
): Promise<ImprovementRecord> {
  const log: PipelineStep[] = [];

  console.log(`\n[self-improve] ===================================`);
  console.log(`[self-improve]   SELF-IMPROVEMENT PIPELINE START`);
  console.log(`[self-improve]   Call: ${callId}`);
  console.log(`[self-improve]   Customer: ${customerNumber || "unknown"}`);
  console.log(`[self-improve] ===================================`);

  // 1. Fetch transcript + current config
  logStep(log, "fetch_transcript", "ok", `Fetching call ${callId} from Vapi...`);
  let call;
  try {
    call = await getCall(callId);
    logStep(log, "fetch_transcript", "ok", `Got transcript (${call.transcript?.length || 0} chars), status=${call.status}, ended=${call.endedReason}`);
  } catch (err) {
    logStep(log, "fetch_transcript", "error", `Failed to fetch call: ${(err as Error).message}`);
    throw err;
  }

  logStep(log, "fetch_assistant", "ok", "Fetching current assistant config...");
  const assistant = await getAssistant(assistantId);
  logStep(log, "fetch_assistant", "ok", `Current prompt: ${assistant.systemMessage.slice(0, 80)}...`);

  const existingTools = getAllTools();
  logStep(log, "check_tools", "ok", `${existingTools.length} existing tools: ${existingTools.map(t => t.name).join(", ") || "none"}`);

  // 2. Analyze with Claude
  logStep(log, "ai_analysis", "ok", "Sending transcript to Claude for analysis...");
  let analysis;
  let rawAnalysisText = "";
  try {
    const result = await analyzeTranscriptWithRaw(
      call.transcript,
      assistant.systemMessage,
      assistant.config,
      existingTools.map((t) => ({ name: t.name, description: t.description }))
    );
    analysis = result.parsed;
    rawAnalysisText = result.raw;
    logStep(log, "ai_analysis", "ok", `Claude identified ${analysis.failures.length} failures, ${analysis.changes.length} changes, ${analysis.newTools?.length || 0} new tools, ${analysis.newWorkflows?.length || 0} new workflows`);
  } catch (err) {
    logStep(log, "ai_analysis", "error", `Claude analysis failed: ${(err as Error).message}`);
    throw err;
  }

  // 3. Create tools
  const toolsCreated: string[] = [];
  if (analysis.newTools?.length) {
    for (const toolSpec of analysis.newTools) {
      try {
        logStep(log, "create_tool", "ok", `Creating tool: "${toolSpec.name}" — ${toolSpec.description}`);
        const tool = await createAndRegisterTool(toolSpec);
        toolsCreated.push(toolSpec.name);

        try {
          const testArgs: Record<string, unknown> = {};
          for (const [key, prop] of Object.entries(toolSpec.parameters.properties)) {
            testArgs[key] = prop.type === "string" ? "test" : 0;
          }
          const output = await tool.handler(testArgs);
          logStep(log, "test_tool", "ok", `Tool "${toolSpec.name}" smoke test passed: ${output.slice(0, 100)}`);
        } catch (testErr) {
          logStep(log, "test_tool", "error", `Tool "${toolSpec.name}" smoke test failed: ${(testErr as Error).message}`);
        }
      } catch (err) {
        logStep(log, "create_tool", "error", `Failed to create tool "${toolSpec.name}": ${(err as Error).message}`);
      }
    }
  } else {
    logStep(log, "create_tool", "skipped", "No new tools requested by analysis");
  }

  // 4. Create n8n workflows
  const workflowsCreated: string[] = [];
  if (analysis.newWorkflows?.length && isN8nConfigured()) {
    for (const wf of analysis.newWorkflows) {
      try {
        if (!wf.steps?.length) {
          logStep(log, "create_workflow", "skipped", `Workflow "${wf.name}" has no steps`);
          continue;
        }

        logStep(log, "create_workflow", "ok", `Creating n8n workflow: "${wf.name}" (${wf.steps.length} steps)`);
        const result = await createCustomWorkflow({
          name: wf.name,
          webhookPath: wf.webhookPath,
          steps: wf.steps,
        });
        workflowsCreated.push(`${wf.name} → ${result.webhookUrl}`);
        logStep(log, "create_workflow", "ok", `Workflow "${wf.name}" deployed: ${result.webhookUrl}`);

        // Create Vapi tool pointing to n8n webhook
        const toolName = wf.webhookPath.replace(/-/g, "_");
        logStep(log, "wire_workflow_to_vapi", "ok", `Creating Vapi tool "${toolName}" → ${result.webhookUrl}`);
        await createAndRegisterTool({
          name: toolName,
          description: `${wf.name} — triggers n8n workflow via webhook`,
          parameters: {
            type: "object",
            properties: {
              to: { type: "string", description: "Recipient phone number or identifier" },
              message: { type: "string", description: "Message content to send" },
            },
            required: ["to", "message"],
          },
          handlerCode: `const res = await ctx.fetch("${result.webhookUrl}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: args.to, message: args.message }) }); const data = await res.json(); return JSON.stringify(data);`,
        });
        toolsCreated.push(toolName);
        logStep(log, "wire_workflow_to_vapi", "ok", `Vapi tool "${toolName}" created and attached to assistant`);
      } catch (err) {
        logStep(log, "create_workflow", "error", `Failed: "${wf.name}": ${(err as Error).message}`);
      }
    }
  } else if (analysis.newWorkflows?.length) {
    logStep(log, "create_workflow", "error", "n8n not configured (N8N_API_URL or N8N_API_KEY missing) — cannot create workflows");
    analysis.resourceRequests = analysis.resourceRequests || [];
    analysis.resourceRequests.push("Need N8N_API_URL and N8N_API_KEY to create workflows programmatically");
  } else {
    logStep(log, "create_workflow", "skipped", "No new workflows requested by analysis");
  }

  // 5. Resource requests
  if (analysis.resourceRequests?.length) {
    for (const req of analysis.resourceRequests) {
      await notifyOperator(`🔑 RESOURCE REQUEST: ${req}`);
      logStep(log, "resource_request", "ok", req);
    }
  }

  // 6. Update assistant
  logStep(log, "update_assistant", "ok", "Applying config changes to Vapi assistant...");
  try {
    await updateAssistant(assistantId, analysis.configChanges);
    logStep(log, "update_assistant", "ok", `Updated: ${Object.keys(analysis.configChanges).join(", ")}`);
  } catch (err) {
    logStep(log, "update_assistant", "error", `Failed to update assistant: ${(err as Error).message}`);
  }

  // 7. Record
  const record: ImprovementRecord = {
    callId,
    customerNumber,
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    toolsCreated,
    workflowsCreated,
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
    callbackTriggered: false,
    rawAnalysis: rawAnalysisText,
    pipelineLog: log,
  };
  history.push(record);

  // 8. Notify operator
  await notifyOperator(
    [
      `🧠 Self-improvement complete (call ${callId})`,
      ``,
      `Failures: ${analysis.failures.map(f => `❌ ${f}`).join("\n")}`,
      `Changes: ${analysis.changes.map(c => `✅ ${c}`).join("\n")}`,
      ...(toolsCreated.length ? [`Tools: ${toolsCreated.join(", ")}`] : []),
      ...(workflowsCreated.length ? [`Workflows: ${workflowsCreated.join(", ")}`] : []),
      customerNumber ? `Calling customer back...` : `No customer number — skipping callback.`,
    ].join("\n")
  );

  // 9. Auto-callback
  if (customerNumber) {
    logStep(log, "callback", "ok", `Triggering callback to ${customerNumber}...`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      const callbackId = await createOutboundCall(assistantId, customerNumber, phoneNumberId);
      record.callbackTriggered = true;
      logStep(log, "callback", "ok", `Callback initiated: ${callbackId}`);
    } catch (err) {
      logStep(log, "callback", "error", `Callback failed: ${(err as Error).message}`);
      await notifyOperator(`⚠️ Failed to call customer back at ${customerNumber}: ${(err as Error).message}`);
    }
  } else {
    logStep(log, "callback", "skipped", "No customer number available");
  }

  console.log(`[self-improve] ===== PIPELINE COMPLETE (${log.length} steps) =====\n`);
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
  newWorkflows?: {
    type: "custom";
    name: string;
    webhookPath: string;
    steps: {
      name: string;
      method: string;
      url: string;
      headers?: Record<string, string>;
      bodyTemplate: string;
    }[];
  }[];
  resourceRequests?: string[];
}

async function analyzeTranscriptWithRaw(
  transcript: string,
  currentPrompt: string,
  currentConfig: Record<string, unknown>,
  existingTools: { name: string; description: string }[]
): Promise<{ parsed: AnalysisResult; raw: string }> {
  const toolList = existingTools.length
    ? existingTools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    : "NO TOOLS CONFIGURED";

  // Fetch existing n8n workflows so the AI can reference them
  let existingWorkflows = "N8N NOT CONFIGURED";
  if (isN8nConfigured()) {
    try {
      const workflows = await listWorkflows();
      if (workflows.length) {
        // Get full details of up to 5 workflows for reference
        const details = await Promise.all(
          workflows.slice(0, 5).map(async (w) => {
            try {
              const full = await getWorkflow(w.id);
              const nodesSummary = full.nodes.map((n) =>
                `    - ${n.name} (${n.type}): ${JSON.stringify(n.parameters).slice(0, 200)}`
              ).join("\n");
              return `  [${w.active ? "ACTIVE" : "inactive"}] "${w.name}" (${w.id})\n${nodesSummary}`;
            } catch {
              return `  [${w.active ? "ACTIVE" : "inactive"}] "${w.name}" (${w.id}) — nodes: ${w.nodes.join(", ")}`;
            }
          })
        );
        existingWorkflows = details.join("\n\n");
      } else {
        existingWorkflows = "NO WORKFLOWS EXIST YET";
      }
    } catch (err) {
      existingWorkflows = `FAILED TO FETCH: ${(err as Error).message}`;
    }
  }

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

EXISTING TOOLS ON VAPI:
${toolList}

EXISTING N8N WORKFLOWS (reference these for patterns — especially any WhatsApp/Whapi integrations):
${existingWorkflows}

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
  "newWorkflows": [
    {
      "type": "custom",
      "name": "Send Customer WhatsApp",
      "webhookPath": "send-customer-whatsapp",
      "steps": [
        {
          "name": "Send via Whapi",
          "method": "POST",
          "url": "https://gate.whapi.cloud/messages/text",
          "headers": { "Authorization": "Bearer WHAPI_TOKEN", "Content-Type": "application/json" },
          "bodyTemplate": "={ \"to\": \"{{ $json.body.to }}\", \"body\": \"{{ $json.body.message }}\" }"
        }
      ]
    }
  ],
  "resourceRequests": [
    "Need Whapi token to send WhatsApp messages",
    "Need n8n API key to create workflows"
  ]
}

Only include configChanges fields that need changing. Always include systemMessage.
Only include newTools if tools are actually missing.
Only include newWorkflows if multi-step automations are needed (WhatsApp, email, etc).
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

  console.log(`[self-improve] Raw Claude response (${text.length} chars)`);

  try {
    return { parsed: JSON.parse(cleaned), raw: text };
  } catch {
    console.error("[self-improve] Failed to parse analysis:", text);
    return {
      parsed: {
        failures: ["Could not parse analysis output"],
        changes: ["No changes made — parse error"],
        configChanges: { systemMessage: currentPrompt },
      },
      raw: text,
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

  const { parsed: analysis, raw: rawAnalysisText } = await analyzeTranscriptWithRaw(
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
    workflowsCreated: [],
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
    callbackTriggered: false,
    rawAnalysis: rawAnalysisText,
    pipelineLog: [],
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
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      await createOutboundCall(assistantId, customerNumber, phoneNumberId);
      record.callbackTriggered = true;
    } catch (err) {
      console.error(`[self-improve] Callback failed:`, err);
    }
  }

  console.log(`[self-improve] ===== MANUAL IMPROVEMENT COMPLETE =====\n`);
  return record;
}
