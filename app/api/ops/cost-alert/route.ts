import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { getAnalyticsEventsSince } from "@/lib/server/repository";

function isAuthorized(request: NextRequest): boolean {
  const expected = env.cronSecret;

  if (!expected) {
    return false;
  }

  const cronHeader = request.headers.get("x-cron-secret");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  return cronHeader === expected || bearerToken === expected;
}

function getDailyStartIso(): string {
  const now = new Date();
  const utcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  return utcStart.toISOString();
}

function estimateCostFromMetadata(metadata: Record<string, unknown>): number {
  const explicit = metadata.estimatedCostUsd;

  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }

  const model = typeof metadata.modelUsed === "string" ? metadata.modelUsed : "";
  const tokensRaw = metadata.approximateTokens;
  const tokens =
    typeof tokensRaw === "number" && Number.isFinite(tokensRaw)
      ? Math.max(0, tokensRaw)
      : 0;

  if (!model || tokens <= 0) {
    return 0;
  }

  const promptTokens = tokens * 0.7;
  const completionTokens = tokens * 0.3;

  const pricing = model.includes("mini")
    ? { promptPer1k: 0.0008, completionPer1k: 0.0032 }
    : { promptPer1k: 0.005, completionPer1k: 0.015 };

  return Number(
    (
      (promptTokens / 1000) * pricing.promptPer1k +
      (completionTokens / 1000) * pricing.completionPer1k
    ).toFixed(6),
  );
}

async function sendWebhookAlert(payload: Record<string, unknown>): Promise<boolean> {
  if (!env.soulawareCostAlertWebhookUrl) {
    return false;
  }

  try {
    const response = await fetch(env.soulawareCostAlertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const threshold = Number.isFinite(env.soulawareCostAlertDailyUsd)
      ? Math.max(0, env.soulawareCostAlertDailyUsd)
      : 0;

    if (threshold <= 0) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        reason: "SOULAWARE_COST_ALERT_DAILY_USD is not configured.",
      });
    }

    const sinceIso = getDailyStartIso();
    const events = await getAnalyticsEventsSince(sinceIso);

    const chatEvents = events.filter((event) => event.eventName === "chat_model_selected");

    const estimatedCostUsd = Number(
      chatEvents
        .reduce((sum, event) => sum + estimateCostFromMetadata(event.metadata), 0)
        .toFixed(6),
    );

    const exceeded = estimatedCostUsd >= threshold;
    let webhookNotified = false;

    if (exceeded) {
      webhookNotified = await sendWebhookAlert({
        service: "soulaware",
        alertType: "daily_cost_threshold_exceeded",
        estimatedCostUsd,
        thresholdUsd: threshold,
        observedAt: new Date().toISOString(),
        sinceIso,
        eventsEvaluated: chatEvents.length,
      });
    }

    return NextResponse.json({
      ok: true,
      enabled: true,
      exceeded,
      estimatedCostUsd,
      thresholdUsd: threshold,
      sinceIso,
      eventsEvaluated: chatEvents.length,
      webhookNotified,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to evaluate cost alert.",
      },
      { status: 500 },
    );
  }
}
