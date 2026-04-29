import { pageContainer } from "@/lib/styles";

const lockAscii = [
  "        @@@@@@        ",
  "     @@@@@@@@@@@@@    ",
  "    @@@@@@@@@@@@@@@   ",
  "   @@@@@@    @@@@@@   ",
  "   @@@@@      @@@@@   ",
  "  @@@@@        @@@@@  ",
  "  @@@@@        @@@@@  ",
  "  @@@@@        @@@@@  ",
  "  @@@@@        @@@@@  ",
  " @@@@@@@@@@@@@@@@@@@@ ",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@  @@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  "@@@@@@@@@@@@@@@@@@@@@@",
  " @@@@@@@@@@@@@@@@@@@@ ",
  " @@@@@@@@@@@@@@@@@@@@ ",
];

const hiddenAscii = String.raw`                                      ***        
                                    ****        
                  ************    ****          
             ***********************            
         ********             *********         
       ******       *************   *****       
     *****        *************       *****     
   *****         ****    ******         *****   
  ****          ****   **** ****           ***  
  ****          **** ****   ****           ***  
   ****          ******    ****          ****   
    ******       *************        ******    
       *****   *************        *****       
         *********             ********         
            ***********************             
          ****    ************                  
        ****                                    
       ****`;

const waveformAscii = String.raw`
         @                   @                           @                   @         
        @@@                 @@@                         @@@                 @@@        
        @@@                 @@@                         @@@                 @@@        
        @@@      @          @@@      @           @      @@@          @      @@@        
        @@@     @@@         @@@     @@@         @@@     @@@         @@@     @@@        
 @      @@@     @@@      @  @@@     @@@      @  @@@     @@@      @  @@@     @@@      @ 
@@@     @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@
@@@     @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@
@@@     @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@
@@@     @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@
@@@     @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@ @@@     @@@     @@@
 @      @@@     @@@      @  @@@     @@@      @  @@@     @@@      @  @@@     @@@      @ 
        @@@     @@@         @@@     @@@         @@@     @@@         @@@     @@@        
        @@@      @          @@@      @           @      @@@          @      @@@        
        @@@                 @@@                         @@@                 @@@        
        @@@                 @@@                         @@@                 @@@        
        @@@                 @@@                         @@@                 @@@        
         @                   @                           @                   @         `;

const dataAscii = String.raw`       @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
       @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@                                  @@
       @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
      @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@`;

const asciiClass =
  "select-none font-mono text-[5px] font-bold leading-[5px] tracking-[2px] text-brand/50";

const privacyItems = [
  {
    title: "Hidden during screen share",
    description: "Only you can see Orionly.",
    ascii: hiddenAscii,
  },
  {
    title: "No meeting bot",
    description: "Records locally, not as a meeting guest.",
    ascii: waveformAscii,
  },
  {
    title: "Encrypted storage",
    description:
      "Your transcripts and notes are protected at rest and in transit with modern encryption.",
    lock: true,
  },
  {
    title: "Your data stays yours",
    description:
      "Conversations are not used for model training. Your workspace memory remains under your control.",
    ascii: dataAscii,
  },
];

export default function Privacy() {
  return (
    <section className="relative py-20">
      <div className={pageContainer}>
        <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
          <div className="border-b border-zinc-800 p-8 md:p-11">
            <h2 className="max-w-5xl text-balance text-3xl font-semibold leading-tight text-zinc-500 md:text-5xl">
              <span className="text-white">Private by default.</span> No bots,
              no surprise screen-share exposure, and no training on your
              conversations.
            </h2>
          </div>

          <div className="grid md:grid-cols-2">
            {privacyItems.map((item, index) => {
              return (
                <article
                  key={item.title}
                  className={`min-h-[270px] border-zinc-800 p-7 ${
                    index % 2 === 0 ? "md:border-r" : ""
                  } ${index < 2 ? "border-b" : ""}`}
                >
                  <h3 className="text-xl font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 max-w-xl text-base font-medium leading-7 text-zinc-500">
                    {item.description}
                  </p>

                  <div className="relative mt-6 h-32 overflow-hidden">
                    {"lock" in item ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <pre className={asciiClass}>
                          {lockAscii.join("\n").replaceAll("@", ".")}
                        </pre>
                      </div>
                    ) : "ascii" in item ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <pre className={asciiClass}>
                          {item.ascii.replaceAll("@", ".").replaceAll("*", ".")}
                        </pre>
                      </div>
                    ) : (
                      null
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
