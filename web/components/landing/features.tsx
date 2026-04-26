import { pageContainer } from "@/lib/styles";

const featureSections = [
  {
    eyebrow: "[01] DURING THE MEETING / LIVE HELP",
    headline:
      "Get useful context while the conversation is still happening.",
    layout: "stacked",
    features: [
      {
        title: "Answers without breaking flow",
        description:
          "Ask about the call, your notes, or past context without leaving the meeting.",
      },
      {
        title: "Context from past conversations",
        description:
          "Bring decisions, objections, and customer history back when they matter.",
      },
      {
        title: "Write notes in the overlay",
        description:
          "Capture thoughts, decisions, and follow-ups in the private overlay while the meeting continues.",
      },
      {
        title: "Ask better follow-up questions",
        description:
          "Surface the next question to ask when the conversation needs more clarity.",
      },
    ],
  },
  {
    eyebrow: "[02] BEFORE THE CALL / PREPARE",
    headline:
      "Walk into meetings with the right memory already in front of you.",
    layout: "split",
    features: [
      {
        title: "Know who you are talking to",
        description:
          "Pull together relevant people, topics, and recent history before the call starts.",
      },
      {
        title: "Bring workspace memory",
        description:
          "Use transcripts, recordings, and notes as a private knowledge base for each meeting.",
      },
      {
        title: "Works where calls happen",
        description:
          "Use Sunless with Zoom, Google Meet, Teams, or recordings you already have.",
      },
      {
        title: "Import existing recordings",
        description:
          "Drop in audio or video files when the meeting already happened somewhere else.",
      },
    ],
  },
  {
    eyebrow: "[03] AFTER THE CALL / MEMORY",
    headline:
      "Turn every call into notes, follow-ups, and searchable team memory.",
    layout: "stacked",
    features: [
      {
        title: "Gets smarter over time",
        description:
          "Sunless learns from every meeting, so each transcript, note, and decision makes future answers more useful.",
      },
      {
        title: "Enhance notes with AI",
        description:
          "Turn rough notes into clear summaries, action items, and cleaner meeting records.",
      },
      {
        title: "Search across past meetings",
        description:
          "Find the exact moment, topic, or answer from previous calls in seconds.",
      },
      {
        title: "Export to your workflow",
        description:
          "Send notes into Markdown, PDF, or the tools your team already uses.",
      },
    ],
  },
];

function PlaceholderVisual() {
  return (
    <div className="-mx-7 -mb-7 mt-8 aspect-[16/10] border-t border-dashed border-zinc-800 bg-zinc-950/45" />
  );
}

function StackedFeatureGrid({
  features,
}: {
  features: { title: string; description: string }[];
}) {
  return (
    <div className="grid md:grid-cols-2">
      {features.map((feature, index) => (
        <article
          key={feature.title}
          className={`flex min-h-[390px] flex-col overflow-hidden border-zinc-800 p-7 ${
            index % 2 === 0 ? "md:border-r" : ""
          } ${index < features.length - 2 ? "border-b" : ""}`}
        >
          <div className="min-h-[118px]">
            <h3 className="text-xl font-semibold text-white">
              {feature.title}
            </h3>
            <p className="mt-2 max-w-xl text-base font-medium leading-7 text-zinc-500">
              {feature.description}
            </p>
          </div>
          <div className="flex-1" />
          <PlaceholderVisual />
        </article>
      ))}
    </div>
  );
}

function SplitFeatureList({
  features,
}: {
  features: { title: string; description: string }[];
}) {
  return (
    <div>
      {features.map((feature, index) => (
        <article
          key={feature.title}
          className={`grid border-zinc-800 md:grid-cols-2 ${
            index < features.length - 1 ? "border-b" : ""
          }`}
        >
          <div
            className={`flex aspect-square flex-col justify-center p-7 md:p-9 ${
              index % 2 === 1 ? "md:order-2" : ""
            }`}
          >
            <h3 className="text-2xl font-semibold text-white">
              {feature.title}
            </h3>
            <p className="mt-3 max-w-xl text-base font-medium leading-7 text-zinc-500">
              {feature.description}
            </p>
          </div>
          <div
            className={`aspect-square border-t border-dashed border-zinc-800 bg-zinc-950/45 md:border-t-0 ${
              index % 2 === 1 ? "md:border-r" : "md:border-l"
            }`}
          />
        </article>
      ))}
    </div>
  );
}

export default function Features() {
  return (
    <section id="features" className="relative py-20">
      <div className={`${pageContainer} space-y-16`}>
        {featureSections.map((section) => (
          <div
            key={section.eyebrow}
            className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40"
          >
            <div className="border-b border-zinc-800 p-8 md:p-11">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-brand/70">
                {section.eyebrow}
              </div>
              <h2 className="mt-5 max-w-4xl text-balance text-3xl font-semibold leading-tight text-white md:text-5xl">
                {section.headline}
              </h2>
            </div>

            {section.layout === "split" ? (
              <SplitFeatureList features={section.features} />
            ) : (
              <StackedFeatureGrid features={section.features} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
