import DownloadButton from "./download-button";

export default function CTA() {
  return (
    <section id="cta" className="relative py-24">
      <div className="container mx-auto max-w-4xl px-6 text-center">
        <h3 className="text-balance text-3xl font-semibold md:text-4xl text-zinc-50">
          Ready to bring your meetings into the light?
        </h3>
        <p className="mx-auto mt-3 max-w-xl text-zinc-400">
          Try Sunless for a few meetings today. It&apos;s free to get started.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <DownloadButton variant="default" size="lg" />
        </div>
      </div>
    </section>
  );
}
