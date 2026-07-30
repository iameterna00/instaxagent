#!/usr/bin/env node
// ==========================================================================
// Local development against the real Instagram API.
//
// Instagram's OAuth redirect and webhook callback both have to be public
// HTTPS URLs, so `localhost:3000` cannot receive them. This starts a
// Cloudflare Tunnel in front of the dev server and hands the dev server the
// resulting public URL as its OAuth redirect, so a real Instagram login and
// real webhook deliveries work locally.
//
//   npm run dev:tunnel
//
// Two modes:
//   * Quick tunnel (default) — no Cloudflare account needed, but the hostname
//     is random and changes on every run, so Meta's dashboard has to be
//     updated each time.
//   * Named tunnel — set CF_TUNNEL_NAME and DEV_TUNNEL_HOSTNAME in .env for a
//     stable hostname you register with Meta once. Requires a domain on
//     Cloudflare. See SETUP.md.
// ==========================================================================

import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import net from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = process.env.PORT || "3000"

const QUICK_URL = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i

// --------------------------------------------------------------------------
// .env parsing. Next loads these itself, but this script runs before Next and
// needs CF_TUNNEL_NAME / DEV_TUNNEL_HOSTNAME to pick a mode.
// --------------------------------------------------------------------------
function readEnvFile(name) {
  const path = resolve(ROOT, name)
  if (!existsSync(path)) return {}

  const out = {}
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    // Strip matching surrounding quotes, the way dotenv does.
    const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, "$2")
    out[key] = value
  }
  return out
}

// Later files win, matching Next's own precedence.
const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") }
const env = { ...fileEnv, ...process.env }

function upsertEnvLocal(updates) {
  const path = resolve(ROOT, ".env.local")
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : []

  for (const [key, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`))
    if (index >= 0) lines[index] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }

  writeFileSync(path, lines.join("\n").replace(/\n+$/, "") + "\n")
  return path
}

// --------------------------------------------------------------------------
// Output helpers
// --------------------------------------------------------------------------
const ESC = String.fromCharCode(27) + "["
const paint = (code) => (s) => `${ESC}${code}m${s}${ESC}0m`
const bold = paint(1)
const dim = paint(2)
const red = paint(31)
const green = paint(32)
const yellow = paint(33)

function panel(publicUrl, stable) {
  const verifyToken = env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
  const rule = "─".repeat(74)

  console.log(`\n${rule}`)
  console.log(` ${bold("Tunnel is live")}  ${green(publicUrl)}`)
  console.log(rule)
  console.log(`
 Paste these into ${bold("developers.facebook.com")} → your app → ${bold("Instagram")}:

   ${bold("Business login settings → OAuth redirect URIs")}
     ${green(`${publicUrl}/api/instagram/callback`)}

   ${bold("Webhooks → Callback URL")}
     ${green(`${publicUrl}/api/instagram/webhook`)}
   ${bold("Webhooks → Verify token")}
     ${verifyToken ? green(verifyToken) : red("INSTAGRAM_WEBHOOK_VERIFY_TOKEN is not set in .env")}

   Subscribe to fields: ${bold("messages")}, ${bold("comments")}
`)

  if (stable) {
    console.log(dim(" This hostname is stable — you only have to register it once.\n"))
  } else {
    console.log(
      yellow(" This is a quick tunnel: the hostname changes every run, so the two URLs\n") +
        yellow(" above must be re-pasted into Meta each time you restart.\n") +
        dim(" For a permanent hostname, see the named-tunnel section in SETUP.md.\n"),
    )
  }
  console.log(`${rule}\n`)
}

// --------------------------------------------------------------------------
// Children
// --------------------------------------------------------------------------
const children = []
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0))
}

function startCloudflared(args) {
  const child = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)

  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      console.error(red("\ncloudflared is not installed, or not on PATH.\n"))
      console.error("Install it:")
      console.error("  Windows   winget install --id Cloudflare.cloudflared")
      console.error("  macOS     brew install cloudflared")
      console.error("  Linux     https://pkg.cloudflare.com/  (cloudflared package)\n")
    } else {
      console.error(red(`\ncloudflared failed to start: ${error.message}\n`))
    }
    shutdown(1)
  })

  child.on("exit", (code) => {
    if (shuttingDown) return
    console.error(red(`\ncloudflared exited (code ${code}) — shutting down the dev server too.\n`))
    shutdown(code ?? 1)
  })

  return child
}

function startNextDev(extraEnv) {
  const bin = resolve(ROOT, "node_modules", "next", "dist", "bin", "next")
  if (!existsSync(bin)) {
    console.error(red("\nCould not find Next in node_modules — run `npm install` first.\n"))
    shutdown(1)
    return
  }

  // Spawning Node directly on Next's bin avoids shell quoting differences
  // between PowerShell, cmd and sh.
  const child = spawn(process.execPath, [bin, "dev", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  })
  children.push(child)

  child.on("exit", (code) => shutdown(code ?? 0))
  return child
}

// cloudflared logs this at ERR level on every quick tunnel even though a quick
// tunnel needs no origin certificate. Relaying it would just look like a fault.
const BENIGN_TUNNEL_LOGS = [/Cannot determine default origin certificate path/i]

/** Forward cloudflared's own logs, but only the parts worth reading. */
function pipeTunnelLogs(child) {
  const relay = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue
      if (!/ERR|error|failed/i.test(line)) continue
      if (BENIGN_TUNNEL_LOGS.some((pattern) => pattern.test(line))) continue
      console.error(dim(`[tunnel] ${line.trim()}`))
    }
  }
  child.stdout.on("data", relay)
  child.stderr.on("data", relay)
}

/**
 * Bail before opening a tunnel we cannot serve. The dev server has to be
 * started by this script — that is how the tunnel URL reaches it as the OAuth
 * redirect — so an already-running `npm run dev` has to be stopped first.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", (error) => resolve(error.code === "EADDRINUSE"))
    probe.once("listening", () => probe.close(() => resolve(false)))
    probe.listen(port)
  })
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
const tunnelName = env.CF_TUNNEL_NAME?.trim()
const configuredHostname = env.DEV_TUNNEL_HOSTNAME?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")

if (tunnelName && !configuredHostname) {
  console.error(red("\nCF_TUNNEL_NAME is set but DEV_TUNNEL_HOSTNAME is not.\n"))
  console.error("A named tunnel needs the public hostname you routed to it, e.g.\n")
  console.error("  CF_TUNNEL_NAME=insta-dev")
  console.error("  DEV_TUNNEL_HOSTNAME=dev.yourdomain.com\n")
  process.exit(1)
}

if (await portInUse(PORT)) {
  console.error(red(`\nPort ${PORT} is already in use.\n`))
  console.error("This script has to start the dev server itself — that is how the tunnel URL")
  console.error("reaches it as the OAuth redirect — so stop the dev server you already have")
  console.error("running (Ctrl-C in its terminal) and run this instead of `npm run dev`.\n")
  console.error(dim("If the port is held by some unrelated program, pick another:"))
  console.error(dim("  PORT=3001 npm run dev:tunnel\n"))
  process.exit(1)
}

// Next 16 takes a lock in .next/dev, so only one dev server can run per
// project no matter which port it is on — changing PORT does not sidestep it.
if (existsSync(resolve(ROOT, ".next", "dev", "lock"))) {
  console.warn(
    yellow("\nA .next/dev lock is present, so another `next dev` may still be running.") +
      "\nOnly one dev server is allowed per project — stop it if startup fails below.\n",
  )
}

if (!env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim()) {
  console.warn(
    yellow("\nINSTAGRAM_WEBHOOK_VERIFY_TOKEN is empty in .env.") +
      "\nMeta's webhook verification will fail until it is set to any random string.\n",
  )
}

function launch(publicUrl, stable, tunnel) {
  pipeTunnelLogs(tunnel)
  panel(publicUrl, stable)

  const redirectUri = `${publicUrl}/api/instagram/callback`
  const hostname = new URL(publicUrl).host

  // A stable hostname is worth persisting; a quick tunnel's is not — writing a
  // hostname that dies on exit would leave a stale redirect URI behind for the
  // next plain `npm run dev`.
  if (stable) {
    const written = upsertEnvLocal({ NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI: redirectUri })
    console.log(dim(` Wrote NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI to ${written}\n`))
  }

  startNextDev({
    // Passed directly to the child so it wins over .env without editing it.
    NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI: redirectUri,
    // next.config.mjs reads this to allow the tunnel host through the dev
    // server's cross-origin check.
    DEV_TUNNEL_HOSTNAME: hostname,
  })
}

if (tunnelName) {
  console.log(dim(`Starting named tunnel "${tunnelName}" → http://localhost:${PORT}`))
  const tunnel = startCloudflared(["tunnel", "run", "--url", `http://localhost:${PORT}`, tunnelName])
  // A named tunnel's hostname is already known, so there is no URL to wait for.
  launch(`https://${configuredHostname}`, true, tunnel)
} else {
  console.log(dim(`Starting quick tunnel → http://localhost:${PORT}`))
  const tunnel = startCloudflared(["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"])

  let launched = false
  const watch = (chunk) => {
    if (launched) return
    const match = String(chunk).match(QUICK_URL)
    if (!match) return
    launched = true
    clearTimeout(timer)
    launch(match[0], false, tunnel)
  }

  // cloudflared prints the quick-tunnel banner on stderr, but has moved it
  // between streams across versions — watch both.
  tunnel.stdout.on("data", watch)
  tunnel.stderr.on("data", watch)

  const timer = setTimeout(() => {
    if (launched) return
    console.error(red("\nTimed out waiting for a tunnel URL from cloudflared.\n"))
    console.error("Try running it by hand to see the error:\n")
    console.error(`  cloudflared tunnel --url http://localhost:${PORT}\n`)
    shutdown(1)
  }, 30_000)
}
