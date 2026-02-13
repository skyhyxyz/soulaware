import type { NextRequest } from "next/server";

const GUEST_COOKIE_NAME = "guest_id";

export const guestCookieName = GUEST_COOKIE_NAME;

export function readGuestId(request: NextRequest): string {
  const guestId = request.cookies.get(GUEST_COOKIE_NAME)?.value;

  if (!guestId) {
    throw new Error("Guest session is missing. Refresh and try again.");
  }

  return guestId;
}
