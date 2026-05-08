"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import DownloadButton from "./download-button";

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 p-4">
      <div className="mx-auto w-fit">
        <div className="relative w-fit overflow-hidden rounded-full border border-zinc-700/80 bg-zinc-950/90 shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-sm before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-brand/5">
          <div className="relative py-1.5 pl-3 pr-1.5">
            <div className="flex items-center gap-8">
              <Link
                href="/"
                className="flex h-9 select-none items-center gap-2 pr-1"
                draggable={false}
                onContextMenu={(event) => event.preventDefault()}
              >
                <Image
                  src="/orion-mark.svg"
                  alt="Orion Logo"
                  width={32}
                  height={32}
                  draggable={false}
                  className="pointer-events-none h-8 w-8 select-none"
                />
                <span className="pointer-events-none text-sm font-semibold text-white">
                  Orion
                </span>
              </Link>

              <Link
                href="/"
                className="text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                Home
              </Link>

              <Link
                href="/pricing"
                className="text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                Pricing
              </Link>

              <Link
                href="/changelog"
                className="text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                Changelog
              </Link>

              <Link
                href="/support"
                className="text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                Support
              </Link>

              <DownloadButton
                variant={isScrolled ? "default" : "outline"}
                size="sm"
              />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
