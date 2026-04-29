<div align="center">
  <img alt="Logo" src="assets/logo.png" width="100" />
</div>
<h1 align="center">
  Orionly
</h1>
<p align="center">
  An AI-powered desktop meeting assistant for real-time transcription, notes, and insights.
</p>

---

## Overview

Orionly is a cross-platform Electron desktop app with a Next.js web companion. It captures audio from your meetings, transcribes in real time via Deepgram, and surfaces AI-generated insights, notes, and chat — all in a lightweight overlay that stays out of your way.

## Monorepo Structure

```
sunless/
├── desktop/   # Electron + React + Vite app
├── web/       # Next.js web app
└── assets/    # Shared assets (logo, etc.)
```

## Getting Started

### Desktop

```bash
cd desktop
npm install
npm run dev
```

### Web

```bash
cd web
npm install
npm run dev
```

## Tech Stack

- **Desktop:** Electron, React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Web:** Next.js, TypeScript, Tailwind CSS
- **Backend:** Firebase, Deepgram (real-time transcription)
- **AI:** Claude API
