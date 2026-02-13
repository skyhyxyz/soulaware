import type { AnalyticsEventName } from "@/types/domain";

export async function trackClientEvent(
  eventName: AnalyticsEventName,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName, metadata }),
    });
  } catch {
    // Ignore analytics failures to keep the core experience responsive.
  }
}
