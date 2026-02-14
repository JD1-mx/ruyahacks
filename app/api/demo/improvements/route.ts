import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const backendUrl = process.env.BACKEND_URL;

  if (!backendUrl) {
    return NextResponse.json(
      { improvements: [], dynamicTools: [] },
      { status: 200 },
    );
  }

  const callId = req.nextUrl.searchParams.get("callId");

  try {
    // Fetch detailed improvement log (includes rawAnalysis + pipelineLog)
    const [logRes, healthRes] = await Promise.all([
      fetch(`${backendUrl}/improvements/log`, {
        headers: { "Content-Type": "application/json" },
      }),
      fetch(`${backendUrl}/health`, {
        headers: { "Content-Type": "application/json" },
      }),
    ]);

    const logData = logRes.ok ? await logRes.json() : { improvements: [] };
    const healthData = healthRes.ok ? await healthRes.json() : { tools: [] };

    let improvements = logData.improvements || [];
    const dynamicTools = (healthData.tools || []).filter(
      (t: { isDynamic?: boolean }) => t.isDynamic,
    );

    if (callId) {
      improvements = improvements.filter(
        (i: { callId?: string }) => i.callId === callId,
      );
    }

    return NextResponse.json({ improvements, dynamicTools });
  } catch {
    return NextResponse.json(
      { improvements: [], dynamicTools: [] },
      { status: 200 },
    );
  }
}
