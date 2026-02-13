import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guestCookieName, readGuestId } from "@/lib/server/guest";
import { deleteGuestData } from "@/lib/server/repository";

export async function POST(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    await deleteGuestData(guestId);

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: guestCookieName,
      value: crypto.randomUUID(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete guest data.",
      },
      { status: 500 },
    );
  }
}
