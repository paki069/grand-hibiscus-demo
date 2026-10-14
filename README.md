# Grand Hibiscus Demo

A public learning copy of a hotel booking and operations platform built with Next.js, TypeScript, React, and Supabase. This repository is for lessons and local experimentation only; it is separate from the private production project.

> Do not connect this demo to production services or real guest data. Use a local Supabase instance and your own development credentials.

## Quick start

Requirements: Node.js 20 or later, npm, and Git. The Supabase CLI is needed to create the local database.

```powershell
git clone https://github.com/paki069/grand-hibiscus-demo.git
cd grand-hibiscus-demo
npm ci
Copy-Item .env.example .env.local
supabase start
supabase db reset
npm run dev
```

Open http://localhost:3002. The project defaults to port 3002 because ports 3000 and 3001 were already in use by other projects in the original development setup; this lets those local apps run at the same time. A port is just the local address where one server listens. If port 3000 is free on your computer, it is completely fine to use it: run `npx next dev --port 3000` and open http://localhost:3000. To make that the default for this copy, change the `dev` script in `package.json` (and `start` if needed). Only one app can use the same port at a time.

If you test notification or reminder emails locally, make sure `NEXT_PUBLIC_SITE_URL` in your ignored `.env.local` matches the address and port you chose. Vercel manages the port for deployed apps; these choices only affect local development.

`supabase db reset` applies the migrations and loads the clearly labelled demo seed data into your local database.

## Environment

`.env.example` contains variable names and safe local defaults, with secret values left blank. Set up local Supabase first, then copy its local URL and anon/service-role keys into `.env.local`. Add a Groq key only if you want to test the server-side assistants. Never commit `.env.local`, reuse a production key, or paste credentials into issues or chat.

`DEMO_PASSWORD` is only used by `npm run seed:users` to create local demo accounts. Choose a disposable password; the script refuses to run against non-local Supabase URLs.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local site on port 3002 (the default can be changed if another port is free) |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Create a production build |
| `npm run test:db` | Run database behavior checks |
| `npm run seed:users` | Create demo accounts in local Supabase only |

The built-in test payment flow is simulated and never processes real payments. Do not enter real card data.
