import Link from "next/link";
import { SettingsActions } from "@/components/settings-actions";

export default function SettingsPage() {
  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8 md:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-8 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm md:p-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-stone-900">Guest Settings</h1>
          <p className="text-sm text-stone-700">
            Manage your current SoulAware guest session and data controls.
          </p>
        </header>

        <section className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <h2 className="text-lg font-semibold text-stone-900">Data controls</h2>
          <p className="text-sm leading-7 text-stone-700">
            Clear local session starts fresh while keeping your guest profile. Delete all
            data removes chat messages, snapshots, and safety events tied to this guest.
          </p>
          <SettingsActions />
        </section>

        <footer className="text-sm">
          <Link href="/chat" className="font-semibold text-stone-900 hover:underline">
            Back to chat
          </Link>
        </footer>
      </div>
    </main>
  );
}
