import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const infoPlistPath = path.resolve(
  scriptDirectory,
  "../node_modules/electron/dist/Electron.app/Contents/Info.plist",
);

if (!existsSync(infoPlistPath)) {
  console.warn(`Electron Info.plist was not found at ${infoPlistPath}`);
  process.exit(0);
}

let urlTypes = [];
let hasUrlTypes = false;
try {
  const encodedUrlTypes = execFileSync(
    "plutil",
    ["-extract", "CFBundleURLTypes", "json", "-o", "-", infoPlistPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const parsedUrlTypes = JSON.parse(encodedUrlTypes);
  if (Array.isArray(parsedUrlTypes)) {
    urlTypes = parsedUrlTypes;
    hasUrlTypes = true;
  }
} catch {
  // The stock Electron development bundle does not define URL schemes.
}

const hasOrionScheme = urlTypes.some(
  (entry) => Array.isArray(entry?.CFBundleURLSchemes) && entry.CFBundleURLSchemes.includes("orion"),
);
if (hasOrionScheme) process.exit(0);

urlTypes.push({
  CFBundleURLName: "Orion",
  CFBundleTypeRole: "Editor",
  CFBundleURLSchemes: ["orion"],
});

execFileSync(
  "plutil",
  [hasUrlTypes ? "-replace" : "-insert", "CFBundleURLTypes", "-json", JSON.stringify(urlTypes), infoPlistPath],
  { stdio: "inherit" },
);

console.log("Registered the orion:// URL scheme in the Electron development bundle.");
