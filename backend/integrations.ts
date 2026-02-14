const WHAPI_BASE = process.env.WHAPI_BASE_URL || "https://gate.whapi.cloud";
const WHAPI_TOKEN = process.env.WHAPI_TOKEN || "";
const N8N_WEBHOOK = process.env.N8N_WEBHOOK_URL || "";

export async function sendWhatsApp(
  to: string,
  body: string
): Promise<{ sent: boolean; id?: string }> {
  const chatId = to.includes("@") ? to : `${to}@s.whatsapp.net`;

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: chatId, body }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[whapi] send failed:", err);
    return { sent: false };
  }

  const data = (await res.json()) as { sent: boolean; message?: { id: string } };
  return { sent: data.sent, id: data.message?.id };
}

export async function notifyOperator(message: string) {
  const phone = process.env.OPERATOR_PHONE;
  if (!phone) {
    console.warn("[operator] OPERATOR_PHONE not set, logging instead:", message);
    return;
  }
  await sendWhatsApp(phone, `🤖 Agent: ${message}`);
}

export async function triggerN8nWorkflow(
  data: Record<string, unknown>
): Promise<unknown> {
  if (!N8N_WEBHOOK) {
    console.warn("[n8n] N8N_WEBHOOK_URL not set, skipping");
    return { skipped: true };
  }

  const res = await fetch(N8N_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  return res.json();
}
