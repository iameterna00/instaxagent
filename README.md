<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Supabase-Postgres-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License" />
</p>

<h1 align="center">⚡ InstaxAgent</h1>

<p align="center">
  <strong>Self-hosted Instagram DM automation — comment-to-DM funnels, keyword triggers, story replies, AI auto-replies, and a live inbox.</strong>
</p>

<p align="center">
  An open-source alternative to ManyChat and Chatfuel. No monthly fees, no vendor lock-in — your data lives in your own Supabase project.
</p>

---

## Features

- **Comment → DM funnels** — keyword or reply-all triggers on any post. DM only, public reply only, or both, with rotating public replies.
- **DM keyword automation** — auto-respond with text, media, or rich cards with buttons. Quick-reply chips guide people through the funnel.
- **Story triggers** — react to story mentions, emoji reactions, and story replies, filtered by emoji or keyword.
- **AI auto-reply** — feed it your account context (niche, products, tone) and let AI handle unmatched DMs.
- **Live inbox** — every conversation in one dashboard, with manual takeover and saved quick responses.
- **Follow gate** — lock content behind a follow; non-followers get a prompt and unlock on one tap.
- **Ice breakers** — managed and synced to your Instagram profile.
- **Human-like sending** — optional typing indicators and randomized delays.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Supabase (Postgres) · Instagram Graph API

## Project layout

```txt
app/api/instagram/callback       OAuth login + token exchange
app/api/instagram/webhook        DM/comment/story webhook handler
app/api/automations              Automation CRUD
app/api/ice-breakers             Ice Breaker management + sync
app/api/inbox                    Conversations, messages, manual send
app/api/ai                       AI agent settings, dry-run test, per-chat control
components/dashboard             Dashboard and automations UI
components/inbox                 Live inbox UI
lib/ai                           AI agent: provider catalog, clients, reply logic
lib/supabase-server.ts           Supabase server client
schema.sql                       Database schema
scripts/09-ai-agent.sql          AI agent tables/columns (run after schema.sql)
```

## Quick start

```bash
git clone https://github.com/iameterna00/instaxagent.git
cd instaxagent
npm install
cp .env.example .env
# fill in .env, then:
npm run dev
```

Open http://localhost:3000.

You need a **Supabase project** and a **Meta developer app** configured for Instagram Business Login before anything works. Full walkthrough: **[SETUP.md](SETUP.md)**.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key, server-side only |
| `NEXT_PUBLIC_INSTAGRAM_APP_ID` | ✅ | Instagram app ID (public) |
| `INSTAGRAM_APP_ID` | ✅ | Instagram app ID (server) |
| `INSTAGRAM_APP_SECRET` | ✅ | Instagram app secret for token exchange |
| `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` | ✅ | OAuth redirect URI, must match Meta exactly |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | ✅ | Any random string; also entered in Meta |
| `META_APP_SECRET` | Optional | Parent Meta app secret, if webhook signatures fail with 401 |

Use the **Instagram app ID/secret** from the Instagram product page in your Meta app — not the parent Meta app ID from Settings → Basic. This is the single most common setup mistake.

**Never** expose `SUPABASE_SERVICE_ROLE_KEY`, `INSTAGRAM_APP_SECRET`, or user access tokens in client-side code.

## Deploy

Deploy the app to **Vercel** and point it at your Supabase project. See [SETUP.md](SETUP.md) for the full sequence, including the Meta webhook configuration that has to happen after the first deploy.

## Testing checklist

- Log in with an Instagram Business/Creator account
- Create a DM keyword automation and send a test DM from another account
- Create a comment keyword automation, comment on the post, confirm public reply + DM
- Add Ice Breakers and verify they sync to your profile
- Toggle AI auto-reply and send an unmatched DM
- Send a manual reply from the inbox

## License

MIT — see [LICENSE](LICENSE).

InstaxAgent is a fork of [ayuuxh2/insta-p8](https://github.com/ayuuxh2/insta-p8) by flexhunt, used and modified under the MIT license.
