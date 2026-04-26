export default function Stats() {
  return (
    <section className="px-6 py-12 bg-gradient-to-b from-zinc-950 via-amber-950/10 to-zinc-950">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-zinc-50 mb-12">
          Built for performance and accuracy
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="text-3xl font-bold text-amber-600 mb-2">100+</div>
            <div className="text-zinc-400">Languages supported</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-600 mb-2">99.9%</div>
            <div className="text-zinc-400">Accuracy rate</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-600 mb-2">50%</div>
            <div className="text-zinc-400">Cost savings</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-amber-600 mb-2">10x</div>
            <div className="text-zinc-400">Faster processing</div>
          </div>
        </div>
      </div>
    </section>
  );
}
