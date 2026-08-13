import Features from "@/components/landing/features";
import CTA from "@/components/landing/cta";
import DownloadButton from "@/components/landing/download-button";
import PageShell from "@/components/layout/page-shell";
import Privacy from "@/components/landing/privacy";
import { fullBleedPreview, pageHeroSpacing, pageHeroText } from "@/lib/styles";
import { AuthErrorFragmentFallback } from "@/components/auth-error-fragment-fallback";

export default function Home() {
  return (
    <PageShell>
      <AuthErrorFragmentFallback />
      <section className={`relative isolate ${pageHeroSpacing}`}>
        <div className={pageHeroText}>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[0.95] tracking-tight text-white md:text-7xl">
            AI meeting assistant that makes you smarter
          </h1>
          <p className="mt-7 max-w-2xl text-balance text-lg font-medium leading-8 text-zinc-400 md:text-xl">
            Orion turns calls, recordings, and videos into transcripts you can
            search, summarize, and chat with in seconds.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <DownloadButton variant="light" size="md" />
          </div>
        </div>

        <div className={`${fullBleedPreview} mt-20`}>
          <div className="relative h-[340px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50 md:h-[440px]">
            <div className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-5 text-sm text-zinc-400">
              <div className="flex items-center gap-5">
                <span className="font-semibold text-zinc-100">Orion</span>
                <span>File</span>
                <span>Edit</span>
                <span>View</span>
                <span>Window</span>
                <span>Help</span>
              </div>
              <span className="hidden md:inline">Preview placeholder</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 top-12 bg-[linear-gradient(180deg,rgba(113,113,122,0.18),rgba(39,39,42,0.72)),radial-gradient(circle_at_35%_45%,rgba(203,195,227,0.18),transparent_28%),radial-gradient(circle_at_68%_35%,rgba(166,155,201,0.14),transparent_30%)]">
              <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px]" />
              <div className="absolute left-1/2 top-1/2 w-[min(520px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-zinc-950/55 p-6 text-left shadow-2xl shadow-black/40 backdrop-blur">
                <div className="text-sm font-semibold text-zinc-200">
                  Q. What did we decide in the meeting?
                </div>
                <p className="mt-2 text-lg font-semibold leading-7 text-white">
                  The placeholder preview will be replaced with the product
                  screenshot or video still.
                </p>
                <div className="mt-5 flex gap-3">
                  <span className="h-9 flex-1 rounded-full bg-white/10" />
                  <span className="h-9 flex-1 rounded-full bg-white/10" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Features />

      <Privacy />

      <CTA />
    </PageShell>
  );
}
