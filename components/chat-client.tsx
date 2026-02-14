"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {content.replace(snapshotPath, "")}
        </p>
        <Link
          href={snapshotPath}
          className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
        >
          Open your snapshot
        </Link>
      </div>
    );
  }

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
      {content}
    </p>
  );
}

export function ChatClient() {
  const router = useRouter();
  const transcriptRef = useRef<HTMLDivElement | null>(null);
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
    const transcriptElement = transcriptRef.current;

    if (!transcriptElement) {
      return;
    }

    transcriptElement.scrollTo({
      top: transcriptElement.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

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
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <section className="sa-panel rounded-3xl px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">
              SoulAware Chat
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Strategic life guidance for direction, decisions, and follow-through.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateSnapshot}
            disabled={isLoading || isSnapshotLoading}
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSnapshotLoading ? "Creating..." : "Create Purpose Snapshot"}
          </button>
        </div>

        <header className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50 to-white px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">
            SoulAware is non-clinical guidance.
          </p>
          <p>
            If you are in immediate danger, call <strong>911</strong>. For emotional
            crisis support in the US, call or text <strong>988</strong>.
          </p>
        </header>

        {safetyPanel ? (
          <section className="mt-4 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-900">
            <h2 className="text-base font-semibold">Safety Support</h2>
            <p className="mt-1 whitespace-pre-wrap">{safetyPanel}</p>
          </section>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <section className="space-y-4">
            <div
              ref={transcriptRef}
              className="h-[56vh] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 md:p-4"
            >
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4">
                  <p className="text-sm text-slate-700">
                    Start with the decision, challenge, or life area that matters most
                    right now. SoulAware will help you clarify and pick one practical
                    next move.
                  </p>
                </div>
              ) : null}

              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`sa-message-enter max-w-[94%] rounded-2xl border px-4 py-3 shadow-sm ${
                    message.role === "user"
                      ? "ml-auto border-amber-300/80 bg-gradient-to-br from-amber-100 to-amber-200 text-slate-900"
                      : "mr-auto border-slate-200 bg-slate-50 text-slate-900"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p
                      className={`text-[11px] font-semibold tracking-[0.08em] uppercase ${
                        message.role === "user" ? "text-slate-700" : "text-slate-500"
                      }`}
                    >
                      {message.role === "user" ? "You" : "SoulAware"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {formatTimestamp(message.createdAt)}
                    </p>
                  </div>

                  {message.role === "assistant" ? (
                    <MessageContent content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.content}
                    </p>
                  )}
                </article>
              ))}

              {isLoading ? (
                <p className="text-xs text-slate-500">SoulAware is thinking...</p>
              ) : null}
            </div>

            <form onSubmit={handleSendMessage} className="space-y-2">
              <label
                htmlFor="chat-input"
                className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500"
              >
                Your message
              </label>
              <textarea
                id="chat-input"
                rows={4}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Share what you are feeling, facing, or deciding..."
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Session ID: <span className="font-mono">{sessionId || "loading"}</span>
                </p>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Send
                </button>
              </div>
            </form>
          </section>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-100">
            <h2 className="text-sm font-semibold tracking-[0.06em] uppercase text-slate-300">
              Session Focus
            </h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-100">
              <li>Share one concrete challenge or decision.</li>
              <li>Name one value you want to honor this week.</li>
              <li>End with one action you can complete today.</li>
            </ul>
            <div className="mt-5 rounded-xl border border-slate-700 bg-slate-800/90 p-3">
              <p className="text-xs text-slate-300">Need immediate support resources?</p>
              <Link
                href="/legal"
                className="mt-1 inline-flex text-sm font-semibold text-amber-300 hover:text-amber-200"
              >
                Open Legal & Safety
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!isDisclaimerAccepted ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-stone-950/55 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-900">Before you begin</h2>
            <p className="mt-2 text-sm text-slate-700">
              SoulAware is an AI life guidance coach, not a licensed therapist. It can
              support reflection and planning, but it is not a substitute for
              professional mental health care.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              If you may harm yourself or others, call <strong>911</strong> now or
              call/text <strong>988</strong> in the US.
            </p>
            <button
              type="button"
              onClick={acceptDisclaimer}
              className="mt-5 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              I understand and want to continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
