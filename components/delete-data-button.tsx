"use client";

import { useState } from "react";

export function DeleteDataButton() {
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleDelete() {
    const shouldDelete = window.confirm(
      "Delete all SoulAware guest data now? This cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setIsBusy(true);
    setStatus("");

    try {
      const response = await fetch("/api/data/delete", { method: "POST" });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to delete data.");
      }

      setStatus("Data deleted. You can continue with a new guest session.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to delete data.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={isBusy}
        onClick={handleDelete}
        className="rounded-full border border-rose-500 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isBusy ? "Deleting..." : "Delete my guest data"}
      </button>
      {status ? <p className="text-xs text-stone-700">{status}</p> : null}
    </div>
  );
}
