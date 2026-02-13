import Link from "next/link";
import { ChatClient } from "@/components/chat-client";

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff8e1,#f6f1e8_40%,#ebe6de)] pb-10">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 md:px-8">
        <Link href="/" className="text-lg font-semibold text-stone-900">
          Soulaware
        </Link>
        <div className="flex items-center gap-3 text-sm text-stone-700">
          <Link href="/legal" className="hover:text-stone-900">
            Legal & Safety
          </Link>
          <Link href="/settings" className="hover:text-stone-900">
            Settings
          </Link>
        </div>
      </nav>
      <ChatClient />
    </main>
  );
}
