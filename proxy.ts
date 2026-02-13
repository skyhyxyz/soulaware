import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guestCookieName } from "@/lib/server/guest";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const guestId = request.cookies.get(guestCookieName)?.value;

  if (!guestId) {
    response.cookies.set({
      name: guestCookieName,
      value: crypto.randomUUID(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
