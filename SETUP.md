# InstaxAgent — Setup & Deploy

Three services, in this order: **Supabase** (database) → **Vercel** (the app) → **Meta** (Instagram access).

The order matters. Meta needs your live Vercel URL for the OAuth redirect and webhook callback, so the app has to be deployed before you can finish the Meta config. Expect one redeploy at the end.

---

## 1. Supabase — the database

Supabase stores your users, automations, conversations, and Instagram access tokens. It does **not** host the app itself.

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine). Pick a region near you.
2. Wait for provisioning (~2 min).
3. Go to **SQL Editor** → **New query**, paste the entire contents of `schema.sql`, and run it.
4. Go to **Project Settings → API** and copy three values:

   | Supabase field | Goes into |
   |---|---|
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` |

> The `service_role` key bypasses all row-level security. It belongs in server environment variables only — never in client code, never committed.

---

## 2. Meta — create the app (part one)

You need an **Instagram Business or Creator account**, linked to a Facebook Page.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App**.
2. Choose the **Business** app type.
3. In the app dashboard, add the **Instagram** product.
4. Open **Instagram → API setup with Instagram business login**.
5. Under **"3. Set up Instagram business login"**, find the **Instagram app ID** and **Instagram app secret**.

> **This is the step most people get wrong.** Use the *Instagram* app ID and secret from this page — not the parent Meta app ID under Settings → Basic. They are different numbers and the OAuth flow will fail silently with the wrong one.

Copy them into:
- `NEXT_PUBLIC_INSTAGRAM_APP_ID` and `INSTAGRAM_APP_ID` — both get the Instagram app ID
- `INSTAGRAM_APP_SECRET` — the Instagram app secret

Also invent a random string now for `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (any password-like string; you'll paste the same value into Meta later).

---

## 3. Local run — confirm it works before deploying

```bash
cp .env.example .env
```

Fill `.env` with the Supabase values, the Instagram values, and:

```env
NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI=http://localhost:3000/api/instagram/callback
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=your_random_string
```

Then add that exact redirect URI in Meta under **Instagram → business login settings → OAuth redirect URIs**. It must match character-for-character — scheme, host, path, no trailing slash.

```bash
npm install
npm run dev
```

Visit http://localhost:3000. In development a **Dev Login** button appears, which fakes a session so you can click through the dashboard without connecting a real account. Real Instagram login won't fully work locally because webhooks can't reach `localhost`.

---

## 4. Vercel — deploy the app

1. Go to [vercel.com/new](https://vercel.com/new) and import `iameterna00/instaxagent`.
2. Framework preset: **Next.js** (auto-detected). Don't change the build settings.
3. Before deploying, expand **Environment Variables** and add every variable from your `.env`, with one change:

   ```env
   NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI=https://YOUR-APP.vercel.app/api/instagram/callback
   ```

   You won't know the final domain until after the first deploy — use your best guess (Vercel usually gives you `instaxagent.vercel.app`), then correct it in step 6 if it differs.
4. **Deploy.**
5. Note your production URL.
6. If the domain differs from your guess: **Settings → Environment Variables**, fix `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI`, then **Deployments → ⋯ → Redeploy**. Environment variable changes do not take effect until you redeploy.

---

## 5. Meta — finish the config (part two)

Now that you have a live URL:

### OAuth redirect

**Instagram → business login settings → OAuth redirect URIs** — add:

```txt
https://YOUR-APP.vercel.app/api/instagram/callback
```

Keep the localhost one too if you still want to develop locally.

### Webhooks

**Instagram → Webhooks** (or **Products → Webhooks → Instagram**):

- **Callback URL:** `https://YOUR-APP.vercel.app/api/instagram/webhook`
- **Verify token:** the exact `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` string from your env vars

Click **Verify and save**. Meta sends a GET request to that URL; if the token matches, it saves. If it fails, the app isn't deployed, the env var didn't take effect (redeploy), or the token has a typo or stray whitespace.

Then **Subscribe** to these fields:

```txt
messages
comments
```

Add `message_reactions` and `messaging_postbacks` if you want story-reaction triggers and button callbacks.

### Permissions

The app requests these scopes:

```txt
instagram_business_basic
instagram_business_manage_messages
instagram_business_manage_comments
```

While your app is in **Development mode**, only accounts added as testers can use it. Add yourself under **App Roles → Roles → Add People → Instagram Tester**, then accept the invite from your Instagram account under **Settings → Apps and websites → Tester invites**.

To let anyone else use it, you must submit for **App Review** with a screencast and a privacy policy URL — yours is `https://YOUR-APP.vercel.app/privacy`. Review takes days to weeks. For personal use, staying in Development mode with your own account as tester is entirely fine.

---

## 6. Verify

1. Open your production URL and click **Connect Instagram**.
2. Complete the OAuth flow — you should land on `/dashboard` with your username and profile picture in the sidebar.
3. Create a DM keyword automation, e.g. trigger `hello`.
4. From a **different** Instagram account, DM your business account `hello`.
5. The reply should land within seconds, and the conversation should appear in **Inbox**.

If nothing happens, check **Vercel → your project → Logs** and filter to `/api/instagram/webhook`. The handler logs the reason for 401s, which distinguishes a missing signature header from a wrong secret.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| OAuth redirects to an error page | Redirect URI mismatch — compare Meta and `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI` character by character |
| "Invalid client_id" | You used the parent Meta app ID instead of the Instagram app ID |
| Webhook verification fails | App not deployed yet, env var change without a redeploy, or token typo |
| Webhook 401s in the logs | Meta is signing with the parent app secret — set `META_APP_SECRET` to the value from Settings → Basic |
| Login works, no automated replies | Webhook fields not subscribed, or the sending account isn't a tester while in Development mode |
| Env var change did nothing | Vercel requires a redeploy after editing environment variables |

---

## Cost

Supabase free tier and Vercel Hobby cover personal use. Vercel Hobby forbids commercial use — if you monetize this, you need a Pro plan.
