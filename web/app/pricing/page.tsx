import Footer from "@/components/landing/footer";
import Navbar from "@/components/landing/navbar";
import Pricing from "@/components/landing/pricing";

export default function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-50">
      <Navbar />
      <Pricing />
      <Footer />
    </div>
  );
}
