import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { name, company, scenario, scenarioDetails, phone, email } =
    await req.json();

  if (!name || !phone || !scenario) {
    return NextResponse.json(
      { error: "Name, phone, and scenario are required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

  if (!apiKey || !assistantId || !phoneNumberId) {
    return NextResponse.json(
      { error: "Server misconfigured: missing Vapi credentials" },
      { status: 500 },
    );
  }

  const res = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId,
      phoneNumberId,
      customer: {
        number: phone,
        name,
      },
      assistantOverrides: {
        variableValues: {
          customerName: name,
          company: company || "Unknown",
          scenario,
          scenarioDetails: scenarioDetails || "",
          email: email || "",
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Vapi error: ${text}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json({ callId: data.id });
}
