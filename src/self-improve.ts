import Anthropic from "@anthropic-ai/sdk";
import { getAssistant, updateAssistantPrompt, getCall } from "./vapi.js";
import { notifyOperator } from "./integrations.js";

const client = new Anthropic();

// --- Improvement history (in-memory) ---

export interface ImprovementRecord {
  callId: string;
  timestamp: string;
  failures: string[];
  changes: string[];
  promptBefore: string;
  promptAfter: string;
}

const history: ImprovementRecord[] = [];

export function getImprovementHistory(): ImprovementRecord[] {
  return history;
}

// --- Core: Analyze transcript + improve ---

export async function analyzeAndImprove(
  callId: string,
  assistantId: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===== SELF-IMPROVEMENT TRIGGERED =====`);
  console.log(`[self-improve] Analyzing call ${callId}...`);

  // 1. Get the call transcript
  const call = await getCall(callId);
  console.log(`[self-improve] Call status: ${call.status}, ended: ${call.endedReason}`);
  console.log(`[self-improve] Transcript length: ${call.transcript?.length || 0} chars`);

  // 2. Get current assistant prompt
  const assistant = await getAssistant(assistantId);
  const currentPrompt = assistant.systemMessage;
  console.log(`[self-improve] Current prompt: ${currentPrompt.length} chars`);

  // 3. Ask Claude to analyze failures and generate improved prompt
  const analysis = await analyzeTranscript(call.transcript, currentPrompt);

  // 4. Update the assistant
  await updateAssistantPrompt(assistantId, analysis.improvedPrompt);

  const record: ImprovementRecord = {
    callId,
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    promptBefore: currentPrompt,
    promptAfter: analysis.improvedPrompt,
  };

  history.push(record);

  console.log(`[self-improve] Failures identified:`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  console.log(`[self-improve] Changes made:`);
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));
  console.log(`[self-improve] ===== IMPROVEMENT COMPLETE =====\n`);

  // Notify operator
  await notifyOperator(
    `Self-improvement after call ${callId}:\n\nFailures:\n${analysis.failures.map((f) => `• ${f}`).join("\n")}\n\nChanges:\n${analysis.changes.map((c) => `• ${c}`).join("\n")}`
  );

  return record;
}

async function analyzeTranscript(
  transcript: string,
  currentPrompt: string
): Promise<{
  failures: string[];
  changes: string[];
  improvedPrompt: string;
}> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: `You are an AI system that improves voice assistant prompts based on failed call transcripts.

You work for Ruya Logistics, a freight forwarding company in Dubai that moves containers from Jebel Ali port to warehouses.

Your job:
1. Read the transcript and identify SPECIFIC failures — where the assistant misunderstood, gave wrong info, or frustrated the caller
2. Generate a CONCRETE list of what went wrong
3. Produce an improved system prompt that fixes these issues

Rules for the improved prompt:
- Keep it concise — this is a voice assistant, not a chatbot
- Add SPECIFIC instructions to handle the failures you identified
- Don't remove existing good behavior, only add improvements
- Focus on practical fixes (e.g., "always spell out numbers digit by digit", "confirm container size: 20ft or 40ft")

Respond with ONLY valid JSON:
{
  "failures": ["specific failure 1", "specific failure 2"],
  "changes": ["what you changed 1", "what you changed 2"],
  "improvedPrompt": "the full improved system prompt"
}`,
    messages: [
      {
        role: "user",
        content: `CURRENT SYSTEM PROMPT:\n${currentPrompt}\n\nCALL TRANSCRIPT:\n${transcript}\n\nAnalyze the failures and produce an improved prompt.`,
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
      failures: ["Could not parse analysis"],
      changes: ["No changes made"],
      improvedPrompt: currentPrompt,
    };
  }
}

// --- Manual trigger: analyze from transcript text directly ---

export async function analyzeFromTranscript(
  transcript: string,
  assistantId: string
): Promise<ImprovementRecord> {
  console.log(`\n[self-improve] ===== MANUAL SELF-IMPROVEMENT =====`);

  const assistant = await getAssistant(assistantId);
  const currentPrompt = assistant.systemMessage;

  const analysis = await analyzeTranscript(transcript, currentPrompt);
  await updateAssistantPrompt(assistantId, analysis.improvedPrompt);

  const record: ImprovementRecord = {
    callId: "manual",
    timestamp: new Date().toISOString(),
    failures: analysis.failures,
    changes: analysis.changes,
    promptBefore: currentPrompt,
    promptAfter: analysis.improvedPrompt,
  };

  history.push(record);

  console.log(`[self-improve] Failures identified:`);
  analysis.failures.forEach((f) => console.log(`   ❌ ${f}`));
  console.log(`[self-improve] Changes made:`);
  analysis.changes.forEach((c) => console.log(`   ✅ ${c}`));
  console.log(`[self-improve] ===== IMPROVEMENT COMPLETE =====\n`);

  await notifyOperator(
    `Manual self-improvement:\n\nFailures:\n${analysis.failures.map((f) => `• ${f}`).join("\n")}\n\nChanges:\n${analysis.changes.map((c) => `• ${c}`).join("\n")}`
  );

  return record;
}
