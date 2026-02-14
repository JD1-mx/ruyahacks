import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;
  const apiKey = process.env.VAPI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: missing Vapi API key" },
      { status: 500 },
    );
  }

  const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Vapi error: ${text}` },
      { status: res.status },
    );
  }

  const data = await res.json();

  // Fire-and-forget improvement request when call ends
  if (data.status === "ended") {
    const backendUrl = process.env.BACKEND_URL;
    if (backendUrl) {
      fetch(`${backendUrl}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    status: data.status,
    transcript: data.transcript,
    messages: data.messages,
    recordingUrl: data.recordingUrl,
    stereoRecordingUrl: data.stereoRecordingUrl,
    analysis: data.analysis,
    duration: data.endedAt && data.startedAt
      ? Math.round(
          (new Date(data.endedAt).getTime() -
            new Date(data.startedAt).getTime()) /
            1000,
        )
      : null,
    endedReason: data.endedReason,
    costs: data.costs,
  });
}
