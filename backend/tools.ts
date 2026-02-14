import type { RegisteredTool, ToolHandler, VapiToolDefinition } from "./types.js";
import { sendWhatsApp, notifyOperator, triggerN8nWorkflow } from "./integrations.js";
import { createVapiTool, addToolToAssistant } from "./vapi.js";

// --- In-memory registry ---

const registry = new Map<string, RegisteredTool>();

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function getAllTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

export function getDynamicTools(): RegisteredTool[] {
  return Array.from(registry.values()).filter((t) => t.isDynamic);
}

export function registerTool(tool: RegisteredTool) {
  registry.set(tool.name, tool);
  console.log(
    `[tools] Registered "${tool.name}" (${tool.isDynamic ? "dynamic" : "seed"})`
  );
}

export function clearDynamicTools() {
  for (const [name, tool] of registry) {
    if (tool.isDynamic) {
      registry.delete(name);
      console.log(`[tools] Removed dynamic tool "${name}"`);
    }
  }
}

// --- Dynamic tool creation (the self-improving part) ---

export async function createAndRegisterTool(spec: {
  name: string;
  description: string;
  parameters: VapiToolDefinition["function"]["parameters"];
  handlerCode: string;
}): Promise<RegisteredTool> {
  // Build handler from code string — intentionally using new Function for hackathon demo
  const handler = buildHandler(spec.handlerCode);

  const tool: RegisteredTool = {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    handler,
    createdAt: new Date().toISOString(),
    isDynamic: true,
  };

  registerTool(tool);

  // Register on Vapi so voice calls can use it too
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const serverUrl = process.env.SERVER_URL;

  if (assistantId && serverUrl) {
    try {
      const vapiToolDef: VapiToolDefinition = {
        type: "function",
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
        },
      };
      const toolId = await createVapiTool(vapiToolDef, `${serverUrl}/vapi/tool-calls`);
      console.log(`[tools] Tool "${spec.name}" registered on Vapi → toolId: ${toolId}`);
      await addToolToAssistant(assistantId, toolId);
      console.log(`[tools] Tool "${spec.name}" ATTACHED to assistant ${assistantId} — assistant updated`);
    } catch (err) {
      console.error(`[tools] Failed to sync "${spec.name}" to Vapi:`, err);
    }
  }

  await notifyOperator(
    `New tool created: "${spec.name}" — ${spec.description}`
  );

  return tool;
}

function buildHandler(code: string): ToolHandler {
  // The handler code has access to these utilities via closure
  const context = { sendWhatsApp, notifyOperator, triggerN8nWorkflow, fetch };

  // Wrap in async function that receives (args, ctx)
  const fn = new Function(
    "args",
    "ctx",
    `return (async () => { ${code} })()`
  ) as (args: Record<string, unknown>, ctx: typeof context) => Promise<string>;

  return (args) => fn(args, context);
}

// --- Seed tools (available at boot) ---

function seedTools() {
  registerTool({
    name: "check_shipment_status",
    description:
      "Check the current status of a shipment by container or booking ID",
    parameters: {
      type: "object",
      properties: {
        shipment_id: {
          type: "string",
          description: "Container number or booking reference",
        },
      },
      required: ["shipment_id"],
    },
    handler: async (args) => {
      const id = args.shipment_id as string;
      // Simulated data — in prod this would hit a TMS/ERP API
      const statuses: Record<string, string> = {
        CONU1234567:
          "Container CONU1234567: Cleared customs at Jebel Ali. In transit to Al Quoz warehouse. ETA 2 hours.",
        MSCU7654321:
          "Container MSCU7654321: Arrived at Jebel Ali port. Pending customs inspection. ETA clearance: 4 hours.",
        BK20240001:
          "Booking BK20240001: 2x 40ft containers. Vessel arrived. Discharge scheduled for tomorrow 0600.",
      };
      return (
        statuses[id] ||
        `Shipment ${id}: No record found. Please verify the ID or contact operations.`
      );
    },
    createdAt: new Date().toISOString(),
    isDynamic: false,
  });

  registerTool({
    name: "send_customer_whatsapp",
    description:
      "Send a WhatsApp message to a customer with shipment updates or information",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string", description: "Customer phone number with country code" },
        message: { type: "string", description: "Message to send" },
      },
      required: ["phone", "message"],
    },
    handler: async (args) => {
      const result = await sendWhatsApp(
        args.phone as string,
        args.message as string
      );
      return result.sent
        ? `WhatsApp message sent successfully to ${args.phone}`
        : `Failed to send WhatsApp message to ${args.phone}`;
    },
    createdAt: new Date().toISOString(),
    isDynamic: false,
  });

  registerTool({
    name: "send_email_notification",
    description:
      "Send an email notification to a customer or internal team via n8n workflow",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body text" },
      },
      required: ["to", "subject", "body"],
    },
    handler: async (args) => {
      const result = await triggerN8nWorkflow({
        type: "send_email",
        to: args.to,
        subject: args.subject,
        body: args.body,
      });
      return `Email workflow triggered for ${args.to}. Result: ${JSON.stringify(result)}`;
    },
    createdAt: new Date().toISOString(),
    isDynamic: false,
  });

  registerTool({
    name: "escalate_to_operator",
    description:
      "Escalate an issue to a human operator via WhatsApp when the agent cannot handle it",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why this needs human attention" },
        context: {
          type: "string",
          description: "Relevant details (customer info, shipment ID, etc.)",
        },
      },
      required: ["reason"],
    },
    handler: async (args) => {
      await notifyOperator(
        `⚠️ ESCALATION: ${args.reason}\nContext: ${args.context || "none"}`
      );
      return "Escalated to operator. They will follow up shortly.";
    },
    createdAt: new Date().toISOString(),
    isDynamic: false,
  });
}

// Initialize seed tools on import
seedTools();
