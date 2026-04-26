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
      <div className="bg-zinc-950/75 backdrop-blur-sm rounded-full border border-zinc-800 shadow-lg shadow-black/30 mx-auto w-fit">
        <div className="px-6 py-2">
          <div className="flex items-center gap-8">
            {/* Logo */}
            <Link href="/" className="flex items-center">
              <Image
                src="/logo2.png"
                alt="Sunless Logo"
                width={32}
                height={32}
                className="w-8 h-8"
              />
            </Link>

            {/* Navigation Links */}
            <a
              href="/pricing"
              className="text-zinc-300 hover:text-white font-medium transition-colors text-sm"
            >
              Pricing
            </a>

            <a
              href="/changelog"
              className="text-zinc-300 hover:text-white font-medium transition-colors text-sm"
            >
              Changelog
            </a>

            <a
              href="/support"
              className="text-zinc-300 hover:text-white font-medium transition-colors text-sm"
            >
              Support
            </a>

            {/* Download Button */}
            <DownloadButton
              variant={isScrolled ? "default" : "outline"}
              size="sm"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
