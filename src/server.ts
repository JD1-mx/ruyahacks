import express from "express";
import type {
  VapiToolCallPayload,
  VapiToolCallResult,
  VapiServerMessage,
  WhapiIncomingMessage,
} from "./types.js";
import { getTool, getAllTools } from "./tools.js";
import { decide } from "./brain.js";
import { sendWhatsApp } from "./integrations.js";
import {
  analyzeAndImprove,
  analyzeFromTranscript,
  getImprovementHistory,
} from "./self-improve.js";
import {
  getAssistant,
  createOutboundCall,
  getCall,
} from "./vapi.js";

const app = express();
app.use(express.json());

// --- Vapi webhook: tool calls ---

app.post("/vapi/tool-calls", async (req, res) => {
  const payload = req.body as VapiToolCallPayload;

  if (payload.message?.type !== "tool-calls") {
    res.status(400).json({ error: "Expected tool-calls message type" });
    return;
  }

  const results: VapiToolCallResult["results"] = [];

  for (const toolCall of payload.message.toolCallList) {
    const { name, arguments: args } = toolCall.function;
    console.log(`[vapi] Tool call: ${name}`, args);

    const tool = getTool(name);

    if (tool) {
      try {
        const result = await tool.handler(args);
        results.push({ toolCallId: toolCall.id, result });
      } catch (err) {
        console.error(`[vapi] Tool "${name}" error:`, err);
        results.push({
          toolCallId: toolCall.id,
          result: `Error executing ${name}: ${(err as Error).message}`,
        });
      }
    } else {
      console.log(`[vapi] Tool "${name}" not found — asking brain to handle`);
      const { result } = await decide(
        `The voice assistant tried to call tool "${name}" with args ${JSON.stringify(args)}, but it doesn't exist. Figure out what the caller needs and either create this tool or use an existing one.`,
        {
          callerPhone: payload.message.call?.customer?.number,
          channel: "vapi",
        }
      );
      results.push({
        toolCallId: toolCall.id,
        result: result || "Unable to process",
      });
    }
  }

  res.json({ results });
});

// --- Vapi webhook: server messages (end-of-call-report) ---

app.post("/vapi/server-message", async (req, res) => {
  const payload = req.body as VapiServerMessage;
  const type = payload.message?.type;

  console.log(`[vapi] Server message: ${type}`);

  if (type === "end-of-call-report") {
    const callId = payload.message.call?.id;
    const assistantId =
      payload.message.call?.assistantId || process.env.VAPI_ASSISTANT_ID;
    const endedReason = payload.message.endedReason;

    console.log(
      `[vapi] Call ended: ${callId}, reason: ${endedReason}`
    );

    // Trigger self-improvement if the call ended badly
    const badEndings = [
      "customer-ended-call",
      "customer-did-not-answer",
      "customer-busy",
    ];
    const shouldImprove =
      endedReason && badEndings.includes(endedReason);

    if (callId && assistantId && shouldImprove) {
      console.log(
        `[vapi] Bad call ending detected (${endedReason}) — triggering self-improvement`
      );
      // Don't await — respond to webhook fast, improve in background
      analyzeAndImprove(callId, assistantId).catch((err) =>
        console.error("[self-improve] Error:", err)
      );
    }

    res.json({ ok: true });
    return;
  }

  // Respond to other message types Vapi sends
  res.json({ ok: true });
});

// --- Whapi webhook: incoming WhatsApp messages ---

app.post("/whapi/incoming", async (req, res) => {
  const payload = req.body as WhapiIncomingMessage;

  if (!payload.messages?.length) {
    res.json({ ok: true });
    return;
  }

  for (const msg of payload.messages) {
    const text = msg.text?.body;
    if (!text) continue;

    const from = msg.from;
    console.log(`[whapi] Message from ${from}: ${text}`);

    const { result } = await decide(text, {
      callerPhone: from,
      channel: "whatsapp",
    });

    if (result) {
      await sendWhatsApp(msg.chat_id, result);
    }
  }

  res.json({ ok: true });
});

// --- Self-improvement: manual trigger ---

app.post("/improve", async (req, res) => {
  const { callId, transcript } = req.body as {
    callId?: string;
    transcript?: string;
  };
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!assistantId) {
    res.status(400).json({ error: "VAPI_ASSISTANT_ID not set" });
    return;
  }

  try {
    let record;
    if (callId) {
      record = await analyzeAndImprove(callId, assistantId);
    } else if (transcript) {
      record = await analyzeFromTranscript(transcript, assistantId);
    } else {
      res.status(400).json({ error: "Provide callId or transcript" });
      return;
    }
    res.json(record);
  } catch (err) {
    console.error("[improve] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Calls: trigger outbound ---

app.post("/calls/create", async (req, res) => {
  const { customerNumber, phoneNumberId } = req.body as {
    customerNumber: string;
    phoneNumberId?: string;
  };
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!assistantId) {
    res.status(400).json({ error: "VAPI_ASSISTANT_ID not set" });
    return;
  }
  if (!customerNumber) {
    res.status(400).json({ error: "customerNumber required" });
    return;
  }

  try {
    const callId = await createOutboundCall(
      assistantId,
      customerNumber,
      phoneNumberId
    );
    res.json({ callId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Calls: get transcript ---

app.get("/calls/:callId", async (req, res) => {
  try {
    const call = await getCall(req.params.callId);
    res.json(call);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Health: tools + improvement history ---

app.get("/health", (_req, res) => {
  const tools = getAllTools().map((t) => ({
    name: t.name,
    description: t.description,
    isDynamic: t.isDynamic,
    createdAt: t.createdAt,
    params: Object.keys(t.parameters.properties),
  }));

  const improvements = getImprovementHistory().map((r) => ({
    callId: r.callId,
    timestamp: r.timestamp,
    failures: r.failures,
    changes: r.changes,
  }));

  res.json({
    status: "ok",
    uptime: process.uptime(),
    toolCount: tools.length,
    tools,
    improvementCount: improvements.length,
    improvements,
  });
});

// --- Current prompt (for demo visibility) ---

app.get("/prompt", async (_req, res) => {
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  if (!assistantId) {
    res.status(400).json({ error: "VAPI_ASSISTANT_ID not set" });
    return;
  }

  try {
    const assistant = await getAssistant(assistantId);
    res.json({ systemMessage: assistant.systemMessage });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Test brain ---

app.post("/test/brain", async (req, res) => {
  const { message, channel } = req.body as {
    message: string;
    channel?: string;
  };

  if (!message) {
    res.status(400).json({ error: "message required" });
    return;
  }

  const { decision, result } = await decide(message, { channel });
  res.json({ decision, result });
});

// --- Start ---

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  const tools = getAllTools();
  console.log(`\n🚀 Ruya Logistics Agent running on port ${PORT}`);
  console.log(`📋 ${tools.length} seed tools loaded`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /vapi/tool-calls      — Vapi tool call webhook`);
  console.log(`  POST /vapi/server-message   — Vapi end-of-call webhook`);
  console.log(`  POST /whapi/incoming        — WhatsApp incoming`);
  console.log(`  POST /improve              — Trigger self-improvement (callId or transcript)`);
  console.log(`  POST /calls/create         — Create outbound call`);
  console.log(`  GET  /calls/:id            — Get call transcript`);
  console.log(`  GET  /prompt               — View current assistant prompt`);
  console.log(`  GET  /health               — Tools + improvement history\n`);
});
