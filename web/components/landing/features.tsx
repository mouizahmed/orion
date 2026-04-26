import { Users, Key, FileText, Ban, Share2, Upload } from "lucide-react";
import Image from "next/image";

export default function Features() {
  return (
    <section id="features" className="relative py-20 bg-zinc-950">
      <div className="container mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-3 gap-6 lg:gap-8">
          {/* First Column, Row 1 - Speaker Identification */}
          <div className="bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-800 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-4">
                <Users className="w-8 h-8 text-zinc-300 mx-auto" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-50 mb-2">
                Speaker Identification
              </h3>
              <p className="text-zinc-400 text-sm">
                Identify and separate speakers completely on your device for
                better context and summaries. Fully private and local.
              </p>
            </div>
          </div>

          {/* Second Column - No meeting bot spanning all 3 rows */}
          <div className="lg:row-span-3 bg-zinc-900 rounded-xl p-8 shadow-sm border border-zinc-800 flex flex-col justify-center text-center">
            <div className="grid grid-cols-4 gap-4 mb-8">
              {/* Platform icons grid */}
              <div className="aspect-square bg-blue-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/zoom.svg"
                  alt="Zoom"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-green-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/facetime.svg"
                  alt="FaceTime"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-orange-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/slack-icon.svg"
                  alt="Slack"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-green-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/whatsapp-icon.svg"
                  alt="WhatsApp"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-green-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/signal.svg"
                  alt="Signal"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-blue-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/google.svg"
                  alt="Google Meet"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-blue-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/telegram.svg"
                  alt="Telegram"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-purple-950/50 rounded-xl flex items-center justify-center p-2 col-start-2">
                <Image
                  src="/discord-icon.svg"
                  alt="Discord"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
              <div className="aspect-square bg-orange-950/50 rounded-xl flex items-center justify-center p-2">
                <Image
                  src="/webex.svg"
                  alt="Webex"
                  width={32}
                  height={32}
                  className="w-8 h-8"
                />
              </div>
            </div>
            <div className="flex justify-center mb-6">
              <Ban className="w-12 h-12 text-zinc-400" />
            </div>
            <h3 className="text-2xl font-semibold text-zinc-50 mb-4">
              No meeting bot
            </h3>
            <p className="text-zinc-400">
              Sunless works with all meeting platforms. No need to worry about
              meeting bots joining your meetings.
            </p>
          </div>

          {/* Third Column, Row 1 - Share notes spanning 2 rows */}
          <div className="lg:row-span-2 bg-zinc-900 rounded-xl p-8 shadow-sm border border-zinc-800 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-6">
                <Share2 className="w-12 h-12 text-zinc-300 mx-auto" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-50 mb-4">
                Share your notes with one click
              </h3>
              <p className="text-zinc-400 mb-6">
                Makes it easy to share notes on the platforms you already use.
                Export to Slack, email, or your favorite collaboration tools
                instantly.
              </p>
              <div className="bg-zinc-950 rounded-lg p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">
                      Slack Integration
                    </span>
                    <div className="w-4 h-4 bg-green-500 rounded"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Email Export</span>
                    <div className="w-4 h-4 bg-blue-500 rounded"></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-400">Team Sharing</span>
                    <div className="w-4 h-4 bg-purple-500 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* First Column, Row 2 - Bring Your Own LLM Key */}
          <div className="bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-800 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-4">
                <Key className="w-8 h-8 text-zinc-300 mx-auto" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-50 mb-2">
                Bring Your Own LLM Key
              </h3>
              <p className="text-zinc-400 text-sm">
                Use any OpenAI compatible endpoint and API key. You can connect
                it to local models through Ollama or use your OpenAI API key.
                Your data stays within your firewall.
              </p>
            </div>
          </div>

          {/* Third Column, Row 3 - Import Any Audio/Video */}
          <div className="bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-800 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-4">
                <Upload className="w-8 h-8 text-zinc-300 mx-auto" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-50 mb-2">
                Import Any Audio/Video
              </h3>
              <p className="text-zinc-400 text-sm">
                Have existing recordings? Drag and drop any audio or video file
                (MP4, MOV, MP3, WAV) for unlimited transcription and AI
                analysis.
              </p>
            </div>
          </div>

          {/* First Column, Row 3 - Auto Export & Obsidian Integration */}
          <div className="bg-zinc-900 rounded-xl p-6 shadow-sm border border-zinc-800 flex items-center justify-center">
            <div className="text-center">
              <div className="mb-4">
                <FileText className="w-8 h-8 text-zinc-300 mx-auto" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-50 mb-2">
                Auto Export & Obsidian Integration
              </h3>
              <p className="text-zinc-400 text-sm">
                Automatically export meetings and transcripts to PDF or Markdown
                with images. Direct integration with Obsidian for seamless
                knowledge management.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
