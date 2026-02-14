"use client";

import { useState } from "react";

const DISCLAIMER_KEY = "soulaware_disclaimer_accepted";
const LAST_SEEN_KEY = "soulaware_last_seen_at";

function clearLocalState() {
  window.localStorage.removeItem(DISCLAIMER_KEY);
  window.localStorage.removeItem(LAST_SEEN_KEY);
}

export function SettingsActions() {
  const [status, setStatus] = useState<string>("");
  const [busyAction, setBusyAction] = useState<"clear" | "delete" | null>(null);

  async function clearSession() {
    setBusyAction("clear");
    setStatus("");

    try {
      const response = await fetch("/api/session/clear", { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to clear session.");
      }

      clearLocalState();
      setStatus("Session cleared. Starting fresh now.");
      window.location.href = "/chat";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to clear session.");
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteAllData() {
    const shouldContinue = window.confirm(
      "Delete all SoulAware data for this guest profile? This cannot be undone.",
    );

    if (!shouldContinue) {
      return;
    }

    setBusyAction("delete");
    setStatus("");

    try {
      const response = await fetch("/api/data/delete", { method: "POST" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to delete data.");
      }

      clearLocalState();
      setStatus("All guest data deleted.");
      window.location.href = "/";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete data.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={clearSession}
        disabled={busyAction !== null}
        className="rounded-full border border-stone-300 px-5 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busyAction === "clear" ? "Clearing..." : "Clear local session"}
      </button>

      <button
        type="button"
        onClick={deleteAllData}
        disabled={busyAction !== null}
        className="rounded-full bg-rose-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busyAction === "delete" ? "Deleting..." : "Delete all stored guest data"}
      </button>

      {status ? <p className="text-sm text-stone-700">{status}</p> : null}
    </div>
  );
}
