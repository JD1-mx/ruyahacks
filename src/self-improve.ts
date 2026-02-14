import Anthropic from "@anthropic-ai/sdk";
import {
  getAssistant,
  updateAssistant,
  getCall,
  type AssistantConfig,
} from "./vapi.js";
import { notifyOperator } from "./integrations.js";

const client = new Anthropic();

// --- Improvement history (in-memory) ---

export interface ImprovementRecord {
  callId: string;
  timestamp: string;
  failures: string[];
  changes: string[];
  configBefore: Record<string, unknown>;
  configAfter: AssistantConfig;
}

const history: ImprovementRecord[] = [];

export function getImprovementHistory(): ImprovementRecord[] {
  return history;
}

// --- The configurable parameters the AI can tune ---
// Each maps a Vapi field to what failure it fixes

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

// --- Core: Analyze transcript + improve ---

export async function analyzeAndImprove(
  callId: string,
  assistantId: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===== SELF-IMPROVEMENT TRIGGERED =====`);
  console.log(`[self-improve] Analyzing call ${callId}...`);

  const call = await getCall(callId);
  console.log(`[self-improve] Call status: ${call.status}, ended: ${call.endedReason}`);
  console.log(`[self-improve] Transcript length: ${call.transcript?.length || 0} chars`);

  const assistant = await getAssistant(assistantId);

  const analysis = await analyzeTranscript(
    call.transcript,
    assistant.systemMessage,
    assistant.config
  );

  await updateAssistant(assistantId, analysis.configChanges);

  const record: ImprovementRecord = {
    callId,
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
  };

  history.push(record);

  console.log(`[self-improve] Failures identified:`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  console.log(`[self-improve] Changes applied:`);
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));
  console.log(`[self-improve] Config keys updated: ${Object.keys(analysis.configChanges).join(", ")}`);
  console.log(`[self-improve] ===== IMPROVEMENT COMPLETE =====\n`);

  await notifyOperator(
    `Self-improvement after call ${callId}:\n\nFailures:\n${analysis.failures.map((f) => `• ${f}`).join("\n")}\n\nChanges:\n${analysis.changes.map((c) => `• ${c}`).join("\n")}`
  );

  return record;
}

async function analyzeTranscript(
  transcript: string,
  currentPrompt: string,
  currentConfig: Record<string, unknown>
): Promise<{
  failures: string[];
  changes: string[];
  configChanges: AssistantConfig;
}> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: `You are a self-improving AI system for voice assistants. You analyze failed call transcripts and produce BOTH prompt improvements AND configuration changes.

You work for Ruya Logistics, a freight forwarding company in Dubai. The assistant handles calls about container movements from Jebel Ali port to warehouses across Dubai.

${TUNABLE_PARAMETERS}

Your job:
1. Read the transcript and identify EVERY specific failure
2. For each failure, determine which parameter(s) would fix it
3. Produce the full improved config

IMPORTANT: Correlate each failure to the parameter that fixes it. For example:
- "Caller said numbers were too fast" → voiceSpeed: 0.85, systemMessage: add "spell digits individually"
- "Response was cut off" → maxTokens: 500
- "Awkward silence when caller looked up container number" → silenceTimeoutSeconds: 20, messagePlan with idle messages
- "Agent didn't confirm container size" → systemMessage: add "always confirm 20ft or 40ft"
- "Caller confused about who they're talking to" → firstMessage improvement

Respond with ONLY valid JSON:
{
  "failures": [
    "Failure description → FIX: parameter_name"
  ],
  "changes": [
    "Human-readable description of each change"
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
  }
}

Only include parameters in configChanges that actually need to change. Always include systemMessage.`,
    messages: [
      {
        role: "user",
        content: `CURRENT SYSTEM PROMPT:\n${currentPrompt}\n\nCURRENT CONFIG:\n${JSON.stringify(currentConfig, null, 2)}\n\nCALL TRANSCRIPT:\n${transcript}\n\nAnalyze ALL failures and produce the improved configuration.`,
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
  assistantId: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===== MANUAL SELF-IMPROVEMENT =====`);

  const assistant = await getAssistant(assistantId);

  const analysis = await analyzeTranscript(
    transcript,
    assistant.systemMessage,
    assistant.config
  );

  await updateAssistant(assistantId, analysis.configChanges);

  const record: ImprovementRecord = {
    callId: "manual",
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    configBefore: assistant.config,
    configAfter: analysis.configChanges,
  };

  history.push(record);

  console.log(`[self-improve] Failures identified:`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  console.log(`[self-improve] Changes applied:`);
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));
  console.log(`[self-improve] ===== IMPROVEMENT COMPLETE =====\n`);

  await notifyOperator(
    `Manual self-improvement:\n\nFailures:\n${analysis.failures.map((f) => `• ${f}`).join("\n")}\n\nChanges:\n${analysis.changes.map((c) => `• ${c}`).join("\n")}`
  );

  return record;
}
