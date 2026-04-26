import type { ReactNode } from "react";
import Footer from "@/components/landing/footer";
import Navbar from "@/components/landing/navbar";

type PageShellProps = {
  children: ReactNode;
  showFooter?: boolean;
  showNavbar?: boolean;
};

export default function PageShell({
  children,
  showFooter = true,
  showNavbar = true,
}: PageShellProps) {
  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-50">
      {showNavbar && <Navbar />}
      <main className="min-h-screen">{children}</main>
      {showFooter && <Footer />}
    </div>
  );
}
