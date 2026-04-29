import PageShell from "@/components/layout/page-shell";
import { pageContainer, pageHeroSpacing } from "@/lib/styles";

const entries = [
  {
    version: "v0.1.0",
    date: "April 2026",
    title: "Initial preview",
    changes: [
      "Dark-mode web experience",
      "Meeting transcript and AI chat preview",
      "Pricing and privacy pages",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <PageShell>
      <section className={`relative pb-20 ${pageHeroSpacing}`}>
        <div className={pageContainer}>
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
              Changelog
            </h1>
            <p className="mt-5 text-lg font-medium leading-8 text-zinc-400 md:text-xl">
              Product updates, fixes, and improvements for Orionly.
            </p>
          </div>

          <div className="mt-12 overflow-hidden rounded-md border border-zinc-800">
            {entries.map((entry) => (
              <article key={entry.version} className="p-8">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-wide text-brand">
                      {entry.version}
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">
                      {entry.title}
                    </h2>
                  </div>
                  <time className="text-sm font-medium text-zinc-500">
                    {entry.date}
                  </time>
                </div>

                <ul className="mt-6 space-y-3 text-sm font-medium text-zinc-300">
                  {entry.changes.map((change) => (
                    <li key={change} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  );
}
