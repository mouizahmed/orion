import PageShell from "@/components/layout/page-shell";
import { pageContainer, pageHeroSpacing, pageNarrow } from "@/lib/styles";

export default function SupportPage() {
  return (
    <PageShell>
      <section className={`relative pb-20 ${pageHeroSpacing}`}>
        <div className={`${pageNarrow} text-center`}>
          <h1 className="text-5xl font-semibold tracking-tight text-white md:text-6xl">
            Support
          </h1>
          <p className="mt-5 text-lg font-medium leading-8 text-zinc-400 md:text-xl">
            Need help with Orion? Email us and we&apos;ll get back to you.
          </p>
        </div>

        <div className={`${pageContainer} relative mt-12`}>
          <div className="overflow-hidden rounded-md border border-zinc-800">
            <div className="flex min-h-14 items-center border-b border-zinc-800 px-8 py-4">
              <div className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Help
              </div>
            </div>

            <div className="p-8">
              <h2 className="text-2xl font-semibold text-white">
                Email support
              </h2>
              <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-400">
                Send questions, bug reports, or account requests.
              </p>
              <a
                href="mailto:support@orion.app"
                className="mt-8 block h-[52px] rounded-md bg-zinc-100 px-6 text-center text-sm font-semibold leading-[52px] text-zinc-950 transition hover:bg-white"
              >
                support@orion.app
              </a>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
