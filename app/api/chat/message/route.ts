import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateCoachReply, renderCoachReply } from "@/lib/server/ai";
import { readGuestId } from "@/lib/server/guest";
import { enforceRateLimit } from "@/lib/server/rate-limit";
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

    if (text.length > 1200) {
      return NextResponse.json(
        { error: "Message is too long. Keep it under 1200 characters." },
        { status: 400 },
      );
    }

    const linkCount = (text.match(/https?:\/\/|www\./gi) ?? []).length;

    if (linkCount > 2) {
      return NextResponse.json(
        { error: "Too many links in one message." },
        { status: 400 },
      );
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const resolvedIp =
      forwardedFor?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const [guestLimit, ipLimit] = await Promise.all([
      enforceRateLimit(`guest:${guestId}`),
      enforceRateLimit(`ip:${resolvedIp}`),
    ]);

    if (!guestLimit.success || !ipLimit.success) {
      const blockedBy = guestLimit.success ? ipLimit : guestLimit;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((blockedBy.reset - Date.now()) / 1000),
      );

      return NextResponse.json(
        { error: "Too many messages. Please wait and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
            "X-RateLimit-Limit": String(blockedBy.limit),
            "X-RateLimit-Remaining": String(blockedBy.remaining),
            "X-RateLimit-Reset": String(Math.floor(blockedBy.reset / 1000)),
          },
        },
      );
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
