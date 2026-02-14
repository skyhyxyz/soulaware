import Link from "next/link";
import { ChatClient } from "@/components/chat-client";
import { BrandWordmark } from "@/components/brand-wordmark";

export default function ChatPage() {
  return (
    <main className="sa-chat-shell min-h-screen px-4 pb-10 pt-5 md:px-8 md:pb-12 md:pt-8">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <header className="sa-panel rounded-3xl px-5 py-4 md:px-7 md:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <BrandWordmark
              subtitle="Strategic life guidance for purpose, career, and clarity"
            />
            <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
              <Link href="/legal" className="transition hover:text-slate-900">
                Legal & Safety
              </Link>
              <Link href="/settings" className="transition hover:text-slate-900">
                Settings
              </Link>
            </nav>
          </div>
        </header>

        <ChatClient />
      </div>
    </main>
  );
}
