import Anthropic from "@anthropic-ai/sdk";
import type { BrainDecision } from "./types.js";
import { getAllTools, getTool, createAndRegisterTool } from "./tools.js";
import { updateAssistantPrompt } from "./vapi.js";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are the brain of Ruya Logistics, an AI agent for freight forwarding in Dubai.
You coordinate container movements from Jebel Ali port to warehouses across Dubai.

Your capabilities:
1. Execute existing tools to fulfill requests
2. Create NEW tools when you don't have the right one (this is your superpower)
3. Respond directly when no tool is needed
4. Escalate to human operators when something is beyond your abilities
5. Update your own system prompt on VAPI when you need to change how you behave

IMPORTANT: You are a SELF-IMPROVING agent. When a request requires a capability you don't have,
you CREATE a new tool instead of saying "I can't do that".

When creating a tool, the handlerCode runs in an async context with access to:
- args: the function arguments object
- ctx.sendWhatsApp(phone, message): send WhatsApp messages
- ctx.notifyOperator(message): message the human operator
- ctx.triggerN8nWorkflow(data): trigger n8n automations
- ctx.fetch(url, options): make HTTP requests
The code MUST return a string.

Respond with ONLY valid JSON matching one of these shapes:

1. Execute existing tool:
{"action":"execute_tool","toolName":"tool_name","toolArgs":{"key":"value"}}

2. Create new tool then execute it:
{"action":"create_tool","newTool":{"name":"snake_case_name","description":"What it does","parameters":{"type":"object","properties":{"param":{"type":"string","description":"desc"}},"required":["param"]},"handlerCode":"return 'result string'"},"toolArgs":{"param":"value"}}

3. Direct response (no tool needed):
{"action":"respond","response":"Your message here"}

4. Escalate to human:
{"action":"escalate","escalationReason":"Why this needs human help"}

5. Update the VAPI assistant prompt (use when behavior/instructions need to change):
{"action":"update_prompt","newPrompt":"The full new system prompt text"}`;

function buildToolContext(): string {
  const tools = getAllTools();
  if (tools.length === 0) return "No tools available.";

  return tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description} [params: ${Object.keys(t.parameters.properties).join(", ")}]${t.isDynamic ? " (self-created)" : ""}`
    )
    .join("\n");
}

export async function decide(
  userMessage: string,
  context?: { callerPhone?: string; channel?: string }
): Promise<{ decision: BrainDecision; result?: string }> {
  const toolContext = buildToolContext();

  const prompt = `Available tools:\n${toolContext}\n\nChannel: ${context?.channel || "unknown"}${context?.callerPhone ? `\nCaller: ${context.callerPhone}` : ""}\n\nUser request: ${userMessage}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse the JSON — strip markdown fences if present
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  let decision: BrainDecision;

  try {
    decision = JSON.parse(cleaned);
  } catch {
    console.error("[brain] Failed to parse decision:", text);
    return {
      decision: { action: "respond", response: text },
      result: text,
    };
  }

  console.log(`[brain] Decision: ${decision.action}${decision.toolName ? ` → ${decision.toolName}` : ""}${decision.newTool ? ` → creating "${decision.newTool.name}"` : ""}`);

  // Execute the decision
  const result = await executeDecision(decision);
  return { decision, result };
}

async function executeDecision(decision: BrainDecision): Promise<string> {
  switch (decision.action) {
    case "execute_tool": {
      const tool = getTool(decision.toolName!);
      if (!tool) {
        return `Tool "${decision.toolName}" not found. Something went wrong.`;
      }
      return tool.handler(decision.toolArgs || {});
    }

    case "create_tool": {
      if (!decision.newTool) return "No tool specification provided.";

      console.log(`[brain] 🔧 SELF-IMPROVING: Creating tool "${decision.newTool.name}"`);

      const newTool = await createAndRegisterTool(decision.newTool);

      // Execute the newly created tool immediately
      const result = await newTool.handler(decision.toolArgs || {});

      console.log(`[brain] ✅ Tool "${decision.newTool.name}" created and executed`);
      return result;
    }

    case "escalate": {
      const { notifyOperator } = await import("./integrations.js");
      await notifyOperator(`ESCALATION: ${decision.escalationReason}`);
      return `I've escalated this to our operations team: ${decision.escalationReason}. They'll follow up shortly.`;
    }

    case "update_prompt": {
      if (!decision.newPrompt) return "No prompt provided.";
      const assistantId = process.env.VAPI_ASSISTANT_ID;
      if (!assistantId) return "VAPI_ASSISTANT_ID not configured.";

      console.log(`[brain] 📝 SELF-IMPROVING: Updating assistant prompt`);
      await updateAssistantPrompt(assistantId, decision.newPrompt);
      const { notifyOperator: notify } = await import("./integrations.js");
      await notify(`📝 Agent updated its own prompt on VAPI`);
      console.log(`[brain] ✅ Prompt updated on VAPI assistant ${assistantId}`);
      return "System prompt updated successfully.";
    }

    case "respond":
      return decision.response || "I'm here to help with your logistics needs.";

    default:
      return "I didn't understand that. Could you rephrase?";
  }
}
