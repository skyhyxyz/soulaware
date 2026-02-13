import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readGuestId } from "@/lib/server/guest";
import { getSnapshotForGuest } from "@/lib/server/repository";
import type { PurposeSnapshotResponse } from "@/types/domain";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const guestId = readGuestId(request);
    const { id } = await context.params;

    const snapshot = await getSnapshotForGuest({ snapshotId: id, guestId });

    if (!snapshot) {
      return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
    }

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
          error instanceof Error ? error.message : "Unable to load snapshot.",
      },
      { status: 500 },
    );
  }
}
