import { pageContainer } from "@/lib/styles";

export default function Footer() {
  return (
    <footer className="bg-transparent py-8 text-sm font-medium text-zinc-400">
      <div className={pageContainer}>
        <p>&copy; 2026 Orionly Inc. All rights reserved.</p>
        <div className="mt-2 flex gap-3">
          <a href="#" className="font-semibold text-zinc-100 underline underline-offset-2">
            Terms of Service
          </a>
          <a href="#" className="underline underline-offset-2 hover:text-zinc-100">
            Privacy Policy
          </a>
        </div>
      </div>
    </footer>
  );
}
