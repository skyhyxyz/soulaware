import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  generateCoachReply,
  generateCoachReplyV2,
  renderCoachReply,
} from "@/lib/server/ai";
import { env } from "@/lib/server/env";
import { readGuestId } from "@/lib/server/guest";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  createMessage,
  createSafetyEvent,
  getLatestSnapshotForSession,
  getOrCreateSession,
  getOrCreateSessionState,
  listMessages,
  listRecentMessages,
  trackEvent,
  updateSessionState,
} from "@/lib/server/repository";
import { evaluateSafety, getSafetyResponseText } from "@/lib/server/safety";
import type { ChatMessageRequest, ChatMessageResponse } from "@/types/domain";

function rolloutBucket(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % 100;
}

function shouldUseChatV2(guestId: string): boolean {
  if (env.soulawareChatEngine !== "v2") {
    return false;
  }

  const percent = Number.isFinite(env.soulawareChatV2Percent)
    ? Math.max(0, Math.min(100, Math.floor(env.soulawareChatV2Percent)))
    : 0;

  if (percent <= 0) {
    return false;
  }

  if (percent >= 100) {
    return true;
  }

  return rolloutBucket(guestId) < percent;
}

async function safeTrackEvent(params: {
  guestId: string;
  eventName:
    | "chat_model_selected"
    | "chat_retry_for_uniqueness"
    | "chat_clarifier_triggered"
    | "chat_summary_updated"
    | "chat_low_quality_fallback"
    | "safety_triggered";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await trackEvent(params);
  } catch (error) {
    console.error("[Soulaware] trackEvent failed", error);
  }
}

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
      forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";

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

      await safeTrackEvent({
        guestId,
        eventName: "safety_triggered",
        metadata: { reason: safety.reason, engine: "safety" },
      });

      const response: ChatMessageResponse = {
        reply: safetyReply,
        mode: "safety",
        messageId: assistantMessage.id,
        safetyTriggered: true,
        responseKind: "safety",
        modelUsed: "safety-guardrail",
        clarifierPending: false,
      };

      return NextResponse.json(response);
    }

    const latestSnapshot = await getLatestSnapshotForSession(session.id);

    if (shouldUseChatV2(guestId)) {
      const messageSlices = await listRecentMessages(session.id, 24);
      const sessionState = await getOrCreateSessionState(session.id);
      const startedAt = Date.now();

      const v2Result = await generateCoachReplyV2({
        text,
        history: messageSlices.allMessages,
        latestSnapshot,
        sessionState,
      });

      await updateSessionState(session.id, v2Result.sessionStatePatch);

      const assistantMessage = await createMessage({
        sessionId: session.id,
        role: "assistant",
        content: v2Result.reply,
        mode: "coach",
      });

      const latencyMs = Date.now() - startedAt;

      await safeTrackEvent({
        guestId,
        eventName: "chat_model_selected",
        metadata: {
          engine: "v2",
          modelUsed: v2Result.modelUsed,
          lens: v2Result.lens,
          responseKind: v2Result.responseKind,
          retryCount: v2Result.retryCount,
          approximateTokens: v2Result.approximateTokens,
          estimatedCostUsd: v2Result.estimatedCostUsd,
          latencyMs,
        },
      });

      if (v2Result.retryCount > 0) {
        await safeTrackEvent({
          guestId,
          eventName: "chat_retry_for_uniqueness",
          metadata: {
            engine: "v2",
            retryCount: v2Result.retryCount,
            modelUsed: v2Result.modelUsed,
          },
        });
      }

      if (v2Result.responseKind === "clarify") {
        await safeTrackEvent({
          guestId,
          eventName: "chat_clarifier_triggered",
          metadata: {
            engine: "v2",
            lens: v2Result.lens,
          },
        });
      }

      if (v2Result.summaryUpdated) {
        await safeTrackEvent({
          guestId,
          eventName: "chat_summary_updated",
          metadata: {
            engine: "v2",
            modelUsed: env.openAiSummaryModel,
          },
        });
      }

      if (v2Result.lowQualityFallback) {
        await safeTrackEvent({
          guestId,
          eventName: "chat_low_quality_fallback",
          metadata: {
            engine: "v2",
            lens: v2Result.lens,
            modelUsed: v2Result.modelUsed,
          },
        });
      }

      const response: ChatMessageResponse = {
        reply: v2Result.reply,
        mode: "coach",
        messageId: assistantMessage.id,
        safetyTriggered: false,
        responseKind: v2Result.responseKind,
        modelUsed: v2Result.modelUsed,
        lens: v2Result.lens,
        clarifierPending: v2Result.clarifierPending,
      };

      return NextResponse.json(response);
    }

    const history = await listMessages(session.id, 12);
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

    await safeTrackEvent({
      guestId,
      eventName: "chat_model_selected",
      metadata: {
        engine: "v1",
        modelUsed: env.openAiModel,
        responseKind: "coach",
      },
    });

    const response: ChatMessageResponse = {
      reply: replyText,
      mode: "coach",
      messageId: assistantMessage.id,
      safetyTriggered: false,
      responseKind: "coach",
      modelUsed: env.openAiModel,
      clarifierPending: false,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process chat message.",
      },
      { status: 500 },
    );
  }
}
