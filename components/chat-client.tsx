"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trackClientEvent } from "@/lib/client/analytics";
import type {
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatMessageResponse,
  PurposeSnapshotResponse,
} from "@/types/domain";

type UiMessage = ChatHistoryMessage;

const DISCLAIMER_KEY = "soulaware_disclaimer_accepted";
const LAST_SEEN_KEY = "soulaware_last_seen_at";

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageContent({ content }: { content: string }) {
  const snapshotPath = content.match(/\/snapshot\/[\w-]+/i)?.[0];

  if (snapshotPath) {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-100">
          {content.replace(snapshotPath, "")}
        </p>
        <Link
          href={snapshotPath}
          className="inline-flex rounded-full bg-amber-300 px-4 py-2 text-xs font-semibold text-stone-900"
        >
          Open your snapshot
        </Link>
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-100">
      {content}
    </p>
  );
}

export function ChatClient() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [isDisclaimerAccepted, setIsDisclaimerAccepted] = useState(false);
  const [safetyPanel, setSafetyPanel] = useState<string>("");

  useEffect(() => {
    const accepted = window.localStorage.getItem(DISCLAIMER_KEY) === "true";
    setIsDisclaimerAccepted(accepted);
  }, []);

  useEffect(() => {
    const lastSeenRaw = window.localStorage.getItem(LAST_SEEN_KEY);
    const now = Date.now();

    trackClientEvent("session_started").catch(() => undefined);

    if (lastSeenRaw) {
      const lastSeen = Number(lastSeenRaw);
      const withinSevenDays = now - lastSeen <= 7 * 24 * 60 * 60 * 1000;

      if (withinSevenDays) {
        trackClientEvent("returned_within_7d").catch(() => undefined);
      }
    }

    window.localStorage.setItem(LAST_SEEN_KEY, `${now}`);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch("/api/chat/history", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Could not load chat history.");
        }

        const payload = (await response.json()) as ChatHistoryResponse;

        if (cancelled) {
          return;
        }

        setSessionId(payload.sessionId);
        setMessages(payload.messages);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load chat history.",
          );
        }
      }
    }

    loadHistory().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const canSend = useMemo(
    () => Boolean(input.trim()) && !isLoading && !isSnapshotLoading,
    [input, isLoading, isSnapshotLoading],
  );

  function acceptDisclaimer() {
    window.localStorage.setItem(DISCLAIMER_KEY, "true");
    setIsDisclaimerAccepted(true);
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isDisclaimerAccepted) {
      setError("Please accept the non-clinical disclaimer before chatting.");
      return;
    }

    const text = input.trim();

    if (!text || isLoading) {
      return;
    }

    setError("");
    setInput("");
    setIsLoading(true);

    const optimisticUserMessage: UiMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      mode: "coach",
    };

    setMessages((previous) => [...previous, optimisticUserMessage]);

    trackClientEvent("message_sent", {
      hasExistingMessages: messages.length > 0,
      sessionId,
    }).catch(() => undefined);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to send message.");
      }

      const payload = (await response.json()) as ChatMessageResponse;

      const assistantMessage: UiMessage = {
        id: payload.messageId,
        role: "assistant",
        content: payload.reply,
        createdAt: new Date().toISOString(),
        mode: payload.mode,
      };

      setMessages((previous) => [...previous, assistantMessage]);

      if (payload.safetyTriggered) {
        setSafetyPanel(payload.reply);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send message.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateSnapshot() {
    if (isSnapshotLoading || isLoading) {
      return;
    }

    setError("");
    setIsSnapshotLoading(true);

    try {
      const response = await fetch("/api/purpose-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextWindow: 12 }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to create snapshot.");
      }

      const payload = (await response.json()) as PurposeSnapshotResponse;
      router.push(`/snapshot/${payload.snapshotId}`);
    } catch (snapshotError) {
      setError(
        snapshotError instanceof Error
          ? snapshotError.message
          : "Unable to create snapshot.",
      );
    } finally {
      setIsSnapshotLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-6 md:px-8">
      <header className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-stone-800">
        <p className="font-semibold">Soulaware is non-clinical guidance.</p>
        <p>
          If you are in immediate danger, call <strong>911</strong>. For emotional
          crisis support in the US, call or text <strong>988</strong>.
        </p>
      </header>

      {safetyPanel ? (
        <section className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-900">
          <h2 className="text-base font-semibold">Safety Support</h2>
          <p className="mt-1 whitespace-pre-wrap">{safetyPanel}</p>
        </section>
      ) : null}

      <section className="flex-1 rounded-3xl border border-stone-200 bg-stone-950/95 p-4 shadow-sm md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-stone-100">Soulaware Chat</h1>
          <button
            type="button"
            onClick={handleCreateSnapshot}
            disabled={isLoading || isSnapshotLoading}
            className="rounded-full bg-amber-300 px-4 py-2 text-xs font-semibold text-stone-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSnapshotLoading ? "Creating..." : "Create Purpose Snapshot"}
          </button>
        </div>

        <div className="h-[58vh] space-y-3 overflow-y-auto rounded-2xl border border-stone-800 bg-stone-900/90 p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-stone-300">
              Start with what matters most to you right now. Soulaware will reflect,
              coach, and help you identify one practical next step.
            </p>
          ) : null}

          {messages.map((message) => (
            <article
              key={message.id}
              className={`max-w-[92%] rounded-2xl px-4 py-3 ${
                message.role === "user"
                  ? "ml-auto bg-amber-300 text-stone-950"
                  : "mr-auto bg-stone-700 text-stone-100"
              }`}
            >
              {message.role === "assistant" ? (
                <MessageContent content={message.content} />
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {message.content}
                </p>
              )}
              <p className="mt-2 text-[11px] opacity-70">{formatTimestamp(message.createdAt)}</p>
            </article>
          ))}

          {isLoading ? (
            <p className="text-xs text-stone-300">Soulaware is thinking...</p>
          ) : null}
        </div>

        <form onSubmit={handleSendMessage} className="mt-4 space-y-2">
          <textarea
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Share what you are feeling, facing, or deciding..."
            className="w-full rounded-2xl border border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100 outline-none ring-amber-300 focus:ring"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-stone-300">
              Session ID: <span className="font-mono">{sessionId || "loading"}</span>
            </p>
            <button
              type="submit"
              disabled={!canSend}
              className="rounded-full bg-amber-300 px-5 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Send
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!isDisclaimerAccepted ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-stone-950/55 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-stone-900">Before you begin</h2>
            <p className="mt-2 text-sm text-stone-700">
              Soulaware is an AI life guidance coach, not a licensed therapist. It
              can support reflection and planning, but it is not a substitute for
              professional mental health care.
            </p>
            <p className="mt-2 text-sm text-stone-700">
              If you may harm yourself or others, call <strong>911</strong> now or
              call/text <strong>988</strong> in the US.
            </p>
            <button
              type="button"
              onClick={acceptDisclaimer}
              className="mt-5 rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white"
            >
              I understand and want to continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
