import Footer from "@/components/landing/footer";
import Navbar from "@/components/landing/navbar";
import Features from "@/components/landing/features";
import CTA from "@/components/landing/cta";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.12),transparent_30%),linear-gradient(180deg,#08080a,#09090b_42rem)]" />

      <Navbar />

      <section className="relative isolate pt-32 md:pt-36">
        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 text-center">
          <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[0.95] tracking-tight text-white md:text-7xl">
            AI meeting assistant that makes you smarter
          </h1>
          <p className="mt-7 max-w-2xl text-balance text-lg font-medium leading-8 text-zinc-400 md:text-xl">
            Sunless turns calls, recordings, and videos into transcripts you can
            search, summarize, and chat with in seconds.
          </p>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#features"
              className="inline-flex h-11 items-center overflow-hidden rounded-full bg-zinc-100 text-sm font-semibold text-zinc-950 transition hover:bg-white"
            >
              <span className="inline-flex h-full items-center gap-2 px-5">
                <span className="grid h-4 w-4 grid-cols-2 gap-0.5">
                  <span className="bg-zinc-950" />
                  <span className="bg-zinc-950" />
                  <span className="bg-zinc-950" />
                  <span className="bg-zinc-950" />
                </span>
                Download
              </span>
              <span className="flex h-full w-11 items-center justify-center border-l border-zinc-300">
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="m6 8 4 4 4-4" />
                </svg>
              </span>
            </a>
          </div>
        </div>

        <div className="mx-auto mt-20 w-full max-w-[calc(100%-3rem)] px-0 md:max-w-[calc(100%-4rem)]">
          <div className="relative h-[340px] overflow-hidden rounded-t-sm border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50 md:h-[440px]">
            <div className="flex h-12 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-5 text-sm text-zinc-400">
              <div className="flex items-center gap-5">
                <span className="font-semibold text-zinc-100">Sunless</span>
                <span>File</span>
                <span>Edit</span>
                <span>View</span>
                <span>Window</span>
                <span>Help</span>
              </div>
              <span className="hidden md:inline">Preview placeholder</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 top-12 bg-[linear-gradient(180deg,rgba(113,113,122,0.18),rgba(39,39,42,0.72)),radial-gradient(circle_at_35%_45%,rgba(202,138,4,0.22),transparent_28%),radial-gradient(circle_at_68%_35%,rgba(34,197,94,0.16),transparent_30%)]">
              <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:24px_24px]" />
              <div className="absolute left-1/2 top-1/2 w-[min(520px,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-zinc-950/55 p-6 text-left shadow-2xl shadow-black/40 backdrop-blur">
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

      <CTA />

      <Footer />
    </div>
  );
}
