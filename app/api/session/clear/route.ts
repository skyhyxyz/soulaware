import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readGuestId } from "@/lib/server/guest";
import { clearSessionData } from "@/lib/server/repository";

export async function POST(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    await clearSessionData(guestId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to clear current session.",
      },
      { status: 500 },
    );
  }
}
