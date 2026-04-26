import Image from "next/image";

export default function Footer() {
  return (
    <footer className="px-6 py-12 bg-transparent text-zinc-400">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-center space-x-2">
            <Image
              src="/logo2.png"
              alt="Sunless Logo"
              width={50}
              height={50}
              className="w-12 h-12 bg-zinc-900 border-zinc-800 rounded-xl"
            />
            <div>
              <span className="font-bold text-zinc-50">Sunless</span>
              <p className="text-sm text-zinc-400 mt-1">
                Where your voice echos into light.
              </p>
            </div>
          </div>

          <div className="flex space-x-12">
            <div>
              <h3 className="font-semibold text-zinc-50 mb-3">Product</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#features" className="hover:text-zinc-100">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="hover:text-zinc-100">
                    How it works
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Download
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Pricing
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-zinc-50 mb-3">Help Center</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Contact us
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-zinc-100">
                    Status page
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-8 text-center text-sm">
          <p>&copy; 2025 Sunless. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
