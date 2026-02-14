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
    const res = await fetch(`${backendUrl}/health`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { improvements: [], dynamicTools: [] },
        { status: 200 },
      );
    }

    const data = await res.json();

    let improvements = data.improvements || [];
    const dynamicTools = data.dynamicTools || [];

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
