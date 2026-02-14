import { NextResponse } from "next/server";

export async function GET() {
  const backendUrl = process.env.BACKEND_URL;

  if (!backendUrl) {
    return NextResponse.json(
      { error: "BACKEND_URL not configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${backendUrl}/state`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Backend error: ${text}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Backend unreachable" },
      { status: 502 },
    );
  }
}
