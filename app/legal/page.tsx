import Link from "next/link";
import { DeleteDataButton } from "@/components/delete-data-button";

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-stone-100 px-4 py-8 md:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-8 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm md:p-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-stone-900">Legal & Safety</h1>
          <p className="text-sm text-stone-700">
            SoulAware is built as a non-clinical AI coaching experience for adults
            (18+).
          </p>
        </header>

        <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-amber-950">Non-clinical disclaimer</h2>
          <p className="text-sm leading-7 text-amber-900">
            SoulAware is not a licensed therapist and does not provide medical or
            psychiatric diagnosis, treatment, or crisis counseling. Use this app for
            personal reflection, planning, and coaching support.
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border border-rose-300 bg-rose-50 p-5">
          <h2 className="text-lg font-semibold text-rose-900">US crisis resources</h2>
          <ul className="space-y-2 text-sm leading-7 text-rose-900">
            <li>
              If you are in immediate danger, call <strong>911</strong> now.
            </li>
            <li>
              Suicide & Crisis Lifeline (US): call or text <strong>988</strong>.
            </li>
            <li>Tell a trusted person and avoid being alone if you feel at risk.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-stone-900">Data handling summary</h2>
          <p className="text-sm leading-7 text-stone-700">
            SoulAware stores guest session content (chat, snapshots, and safety events)
            to provide continuity across refreshes. You can clear your local session or
            permanently delete all stored guest data at any time.
          </p>
          <DeleteDataButton />
        </section>

        <footer className="flex flex-wrap gap-3 text-sm">
          <Link href="/chat" className="font-semibold text-stone-900 hover:underline">
            Back to chat
          </Link>
          <Link
            href="/settings"
            className="font-semibold text-stone-900 hover:underline"
          >
            Open settings
          </Link>
        </footer>
      </div>
    </main>
  );
}
