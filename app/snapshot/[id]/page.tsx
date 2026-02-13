import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { guestCookieName } from "@/lib/server/guest";
import { getSnapshotForGuest } from "@/lib/server/repository";

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const guestId = cookieStore.get(guestCookieName)?.value;

  if (!guestId) {
    notFound();
  }

  const snapshot = await getSnapshotForGuest({
    snapshotId: id,
    guestId,
  });

  if (!snapshot) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff3cf,#f4efe8,#ece6dc)] px-4 py-8 md:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-6 rounded-3xl border border-stone-200 bg-white/90 p-6 shadow-sm md:p-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            Purpose Snapshot
          </p>
          <h1 className="text-3xl font-semibold text-stone-900">Your current direction</h1>
        </header>

        <section className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-5">
          <h2 className="text-lg font-semibold text-stone-900">Mission statement</h2>
          <p className="text-sm leading-7 text-stone-700">{snapshot.mission}</p>
        </section>

        <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-stone-900">Top 5 values</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {snapshot.values.map((value) => (
              <li
                key={value}
                className="rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900"
              >
                {value}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-stone-900">Next 3 actions</h2>
          <ol className="space-y-2 text-sm leading-7 text-stone-700">
            {snapshot.nextActions.map((action) => (
              <li key={action} className="flex items-start gap-3">
                <span className="mt-1 h-4 w-4 rounded border border-stone-400" />
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="flex flex-wrap gap-3">
          <Link
            href="/chat"
            className="rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white"
          >
            Back to chat
          </Link>
          <Link
            href="/settings"
            className="rounded-full border border-stone-300 px-5 py-2 text-sm font-semibold text-stone-800"
          >
            Settings
          </Link>
        </footer>
      </div>
    </main>
  );
}
