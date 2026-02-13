import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,#ffe9a8,#f4eee5_45%,#e9e2d6)] px-5 py-8 md:px-10 md:py-10">
      <div className="mx-auto flex min-h-[88vh] w-full max-w-6xl flex-col rounded-[2rem] border border-stone-200/80 bg-white/80 p-6 shadow-xl backdrop-blur md:p-10">
        <header className="flex items-center justify-between">
          <p className="text-lg font-semibold tracking-tight text-stone-900">Soulaware</p>
          <Link
            href="/legal"
            className="text-sm font-medium text-stone-700 transition hover:text-stone-900"
          >
            Disclaimer & Privacy
          </Link>
        </header>

        <section className="my-auto grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-6">
            <p className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-4 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">
              POC Launch
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-stone-900 md:text-6xl">
              Discover your soul&apos;s true direction with guided AI coaching.
            </h1>
            <p className="max-w-xl text-base leading-7 text-stone-700 md:text-lg">
              Soulaware is an AI life guidance coach that helps you reflect, map
              purpose, and choose practical next actions across life, career, and
              meaning.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Start as Guest
              </Link>
              <Link
                href="/legal"
                className="rounded-full border border-stone-300 px-6 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Read Safety Policy
              </Link>
            </div>
          </div>

          <aside className="rounded-3xl border border-stone-200 bg-gradient-to-b from-stone-900 to-stone-800 p-6 text-stone-100 shadow-lg">
            <h2 className="text-lg font-semibold">What you can do in this POC</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-200">
              <li>Open an AI coaching conversation instantly.</li>
              <li>Generate a Purpose Snapshot with mission, values, and actions.</li>
              <li>Keep your recent session history and clear it anytime.</li>
              <li>Use built-in US crisis safeguards when risk language is detected.</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  );
}
