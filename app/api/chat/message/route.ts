import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateCoachReply, renderCoachReply } from "@/lib/server/ai";
import { readGuestId } from "@/lib/server/guest";
import {
  createMessage,
  createSafetyEvent,
  getLatestSnapshotForSession,
  getOrCreateSession,
  listMessages,
  trackEvent,
} from "@/lib/server/repository";
import { evaluateSafety, getSafetyResponseText } from "@/lib/server/safety";
import type { ChatMessageRequest, ChatMessageResponse } from "@/types/domain";

export async function POST(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    const payload = (await request.json()) as ChatMessageRequest;
    const text = payload?.text?.trim();

    if (!text) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    const session = await getOrCreateSession(guestId);

    await createMessage({
      sessionId: session.id,
      role: "user",
      content: text,
      mode: "coach",
    });

    const safety = await evaluateSafety(text);

    if (safety.isTriggered) {
      const safetyReply = getSafetyResponseText();

      await createSafetyEvent({
        sessionId: session.id,
        guestId,
        level: safety.level,
        triggerText: text,
      });

      const assistantMessage = await createMessage({
        sessionId: session.id,
        role: "assistant",
        content: safetyReply,
        mode: "safety",
      });

      await trackEvent({
        guestId,
        eventName: "safety_triggered",
        metadata: { reason: safety.reason },
      });

      const response: ChatMessageResponse = {
        reply: safetyReply,
        mode: "safety",
        messageId: assistantMessage.id,
        safetyTriggered: true,
      };

      return NextResponse.json(response);
    }

    const history = await listMessages(session.id, 12);
    const latestSnapshot = await getLatestSnapshotForSession(session.id);
    const draft = await generateCoachReply({
      text,
      history,
      latestSnapshot,
    });

    const replyText = renderCoachReply(draft);

    const assistantMessage = await createMessage({
      sessionId: session.id,
      role: "assistant",
      content: replyText,
      mode: "coach",
    });

    const response: ChatMessageResponse = {
      reply: replyText,
      mode: "coach",
      messageId: assistantMessage.id,
      safetyTriggered: false,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process chat message.",
      },
      { status: 500 },
    );
  }
}
