import { updateAssistant, type AssistantConfig } from "./vapi.js";
import { clearDynamicTools } from "./tools.js";
import { clearHistory } from "./self-improve.js";

// The deliberately weak baseline — no tools, bare prompt, bad config
export const BASELINE: AssistantConfig = {
  systemMessage:
    "You are a logistics assistant for Ruya Logistics in Dubai. You help customers with shipping and container inquiries from Jebel Ali port.",
  maxTokens: 250,
  voiceSpeed: 1.0,
  firstMessage: "Hello, this is Ruya Logistics.",
  silenceTimeoutSeconds: 10,
  toolIds: [],
  messagePlan: {
    idleMessages: [],
    idleTimeoutSeconds: 10,
    idleMessageMaxSpokenCount: 0,
  },
};

export async function resetToBaseline(assistantId: string): Promise<void> {
  console.log(`\n[baseline] ===== RESETTING TO BASELINE =====`);

  // 1. Reset assistant config on Vapi
  await updateAssistant(assistantId, BASELINE);
  console.log(`[baseline] Assistant prompt + config reset`);

  // 2. Remove all dynamically created tools from local registry
  clearDynamicTools();
  console.log(`[baseline] Dynamic tools cleared`);

  // 3. Clear improvement history
  clearHistory();
  console.log(`[baseline] Improvement history cleared`);

  console.log(`[baseline] ===== BASELINE RESTORED =====\n`);
}
