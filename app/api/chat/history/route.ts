import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readGuestId } from "@/lib/server/guest";
import { getOrCreateSession, listMessages } from "@/lib/server/repository";
import type { ChatHistoryResponse } from "@/types/domain";

export async function GET(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    const session = await getOrCreateSession(guestId);
    const messages = await listMessages(session.id);

    const response: ChatHistoryResponse = {
      sessionId: session.id,
      messages,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load chat history.",
      },
      { status: 500 },
    );
  }
}
