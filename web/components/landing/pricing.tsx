"use client";

import { useState } from "react";

type Plan = {
  name: string;
  price: string;
  cents?: string;
  suffix?: string;
  features: string[];
  button: string;
  cta?: boolean;
};

const plans: Plan[] = [
  {
    name: "Free",
    price: "$0",
    suffix: "/month",
    features: [
      "200 minutes / month credits",
      "AI meeting notes and summaries",
      "Extract custom insights with AI",
      "Basic integrations (Slack, Gmail, etc)",
    ],
    button: "Get started",
  },
  {
    name: "Pro",
    price: "$8",
    cents: ".33",
    suffix: "/month",
    features: [
      "1500 minutes / month credits",
      "Extract custom insights with AI",
      "Unlimited live suggestions and coaching",
      "Send pre-readings before meeting",
      "CRM integration",
    ],
    button: "Start trial",
  },
];

export default function Pricing() {
  const [isAnnual, setIsAnnual] = useState(true);

  return (
    <section id="pricing" className="relative min-h-screen bg-[#07080a] px-4 py-24 text-white">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-[radial-gradient(rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:6px_6px] opacity-25" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-[radial-gradient(rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:6px_6px] opacity-25" />

      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-md border border-zinc-800">
        <div className="flex min-h-14 flex-col gap-4 border-b border-zinc-800 px-8 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Plans
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide">
            <span className={!isAnnual ? "text-zinc-100" : "text-zinc-600"}>
              Monthly
            </span>
            <button
              type="button"
              aria-pressed={isAnnual}
              onClick={() => setIsAnnual((value) => !value)}
              className={`relative h-5 w-10 rounded-full transition ${
                isAnnual ? "bg-brand" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-zinc-100 transition ${
                  isAnnual ? "left-[21px]" : "left-0.5"
                }`}
              />
            </button>
            <span className={isAnnual ? "text-zinc-100" : "text-zinc-600"}>
              Yearly
            </span>
            <span className="text-brand">-20%</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2">
          {plans.map((plan, index) => (
            <article
              key={plan.name}
              className={`flex min-h-[344px] flex-col border-zinc-800 p-8 ${
                index % 2 === 0 ? "md:border-r" : ""
              }`}
            >
              <h2 className="text-lg font-bold text-zinc-700">{plan.name}</h2>

              <div className="mt-7 flex items-end">
                {plan.price === "Contact us" ? (
                  <div className="text-5xl font-semibold tracking-tight text-zinc-400">
                    Contact us
                  </div>
                ) : (
                  <>
                    <span className="text-5xl font-semibold tracking-tight text-white">
                      {plan.price}
                    </span>
                    {plan.cents && (
                      <span className="pb-1 text-3xl font-semibold text-zinc-400">
                        {plan.cents}
                      </span>
                    )}
                    <span className="pb-2 text-base font-semibold text-zinc-700">
                      {plan.suffix}
                    </span>
                  </>
                )}
              </div>

              <ul className="mt-7 space-y-3 text-sm font-semibold">
                {plan.features.map((feature, index) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        index === 0
                          ? "bg-zinc-100 text-zinc-950"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {index === 0 ? "+" : "v"}
                    </span>
                    <span className="text-zinc-100">{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                className={`mt-auto h-[52px] rounded-md text-sm font-semibold transition ${
                  plan.cta
                    ? "bg-brand text-white hover:bg-brand-light"
                    : "bg-zinc-100 text-zinc-950 hover:bg-white"
                }`}
              >
                {plan.button}
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
