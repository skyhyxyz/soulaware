import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generatePurposeSnapshot } from "@/lib/server/ai";
import { readGuestId } from "@/lib/server/guest";
import {
  createMessage,
  createPurposeSnapshot,
  getLatestSnapshotForSession,
  getOrCreateSession,
  listMessages,
  trackEvent,
} from "@/lib/server/repository";
import type { PurposeSnapshotRequest, PurposeSnapshotResponse } from "@/types/domain";

export async function POST(request: NextRequest) {
  try {
    const guestId = readGuestId(request);
    const payload = (await request.json()) as PurposeSnapshotRequest;

    const contextWindow =
      typeof payload.contextWindow === "number" && payload.contextWindow > 0
        ? Math.min(payload.contextWindow, 24)
        : 12;

    const session = await getOrCreateSession(guestId);
    const history = await listMessages(session.id, contextWindow);
    const latestSnapshot = await getLatestSnapshotForSession(session.id);

    const generated = await generatePurposeSnapshot({
      history,
      latestSnapshot,
    });

    const snapshot = await createPurposeSnapshot({
      sessionId: session.id,
      mission: generated.mission,
      values: generated.values,
      nextActions: generated.nextActions,
    });

    await createMessage({
      sessionId: session.id,
      role: "assistant",
      mode: "coach",
      content: `Purpose Snapshot created. Open it here: /snapshot/${snapshot.id}`,
    });

    await trackEvent({
      guestId,
      eventName: "snapshot_created",
      metadata: { snapshotId: snapshot.id },
    });

    const response: PurposeSnapshotResponse = {
      snapshotId: snapshot.id,
      mission: snapshot.mission,
      values: snapshot.values,
      nextActions: snapshot.nextActions,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate purpose snapshot.",
      },
      { status: 500 },
    );
  }
}
