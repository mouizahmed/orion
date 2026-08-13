# Orion Web

Next.js marketing and callback app for Orion. Supabase login returns to `/auth/callback`, which validates the short-lived result and redirects it into a same-origin `/auth/complete` URL fragment. The styled completion page immediately clears the fragment and forwards it to `orion://auth/callback`. Neither route exchanges the code or owns a Supabase session; Electron remains the PKCE verifier and session owner. Calendar integration callbacks remain separate.

## Development

```bash
npm install
npm run dev
```

The app defaults to `http://localhost:3000`.

## Build

```bash
npm run build
```
