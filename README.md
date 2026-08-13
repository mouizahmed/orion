<div align="center">
  <img alt="Logo" src="assets/logo.png" width="100" />
</div>
<h1 align="center">
  Orion
</h1>
<p align="center">
  An AI-powered desktop meeting assistant for real-time transcription, notes, and insights.
</p>

---

## Overview

Orion is a cross-platform Electron desktop app with a Next.js web companion. It captures audio from your meetings, transcribes in real time via Deepgram, and surfaces AI-generated insights, notes, and chat all in a lightweight overlay that stays out of your way.

Authentication is provided by managed Supabase Auth. Orion's web callback relays the short-lived PKCE result to the desktop, while Electron main alone retains the verifier, completes Google/Microsoft login, and stores sessions with OS-backed encryption. Orion application data remains accessible only through the Go backend and its least-privileged PostgreSQL role. Google and Microsoft calendar consent are intentionally separate integration flows.
