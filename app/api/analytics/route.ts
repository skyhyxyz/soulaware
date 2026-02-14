import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readGuestId } from "@/lib/server/guest";
import { trackEvent } from "@/lib/server/repository";
import type { AnalyticsEventName } from "@/types/domain";

const allowedEvents: AnalyticsEventName[] = [
  "session_started",
  "message_sent",
  "snapshot_created",
  "safety_triggered",
  "returned_within_7d",
  "chat_model_selected",
  "chat_retry_for_uniqueness",
  "chat_clarifier_triggered",
  "chat_summary_updated",
  "chat_low_quality_fallback",
];

export async function POST(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    const payload = (await request.json()) as {
      eventName?: AnalyticsEventName;
      metadata?: Record<string, unknown>;
    };

    if (!payload.eventName || !allowedEvents.includes(payload.eventName)) {
      return NextResponse.json(
        { error: "Invalid analytics event." },
        { status: 400 },
      );
    }

    await trackEvent({
      guestId,
      eventName: payload.eventName,
      metadata: payload.metadata,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to track analytics event.",
      },
      { status: 500 },
    );
  }
}
