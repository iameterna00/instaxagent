"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Zap, MessageCircle, Sparkles, ArrowRight, Github, Star,
  Send, AtSign, Brain, Inbox, Lock, Terminal,
} from "lucide-react"
import { ThemeToggle } from "@/components/layout/theme-toggle"

const GITHUB_URL = "https://github.com/iameterna00/instaxagent"

const FEATURES = [
  {
    icon: MessageCircle,
    title: "Comment → DM funnels",
    desc: "Keyword or reply-all triggers on any post. Choose DM only, public reply only, or both — with your own rotating public replies.",
  },
  {
    icon: Send,
    title: "DM keyword automation",
    desc: "Auto-respond to DMs with text, media, or rich cards with buttons. Quick-reply chips guide people through your funnel.",
  },
  {
    icon: AtSign,
    title: "Story triggers",
    desc: "React to story mentions, emoji reactions, and story replies. Filter by emoji or keyword.",
  },
  {
    icon: Brain,
    title: "AI auto-reply",
    desc: "Feed it your account context — niche, products, tone — and let AI handle unmatched DMs like a human.",
  },
  {
    icon: Inbox,
    title: "Live inbox",
    desc: "Every conversation in one dashboard. Jump in manually anytime, fire quick responses from your saved automations.",
  },
  {
    icon: Lock,
    title: "Follow gate",
    desc: "Lock content behind a follow. Non-followers get a follow prompt; one tap later they unlock the goods.",
  },
  {
    icon: Sparkles,
    title: "Human-like sending",
    desc: "Optional typing indicators and randomized delays so replies land natural, not botty.",
  },
  {
    icon: Terminal,
    title: "Self-hosted & hackable",
    desc: "Next.js + Supabase. Deploy on free tiers. Read every line, fork it, own your data and your tokens.",
  },
]

const MARQUEE_ITEMS = [
  "comment → DM", "keyword triggers", "story reactions", "AI auto-reply", "live inbox",
  "ice breakers", "follow gate", "quick replies", "media attachments", "public + private replies",
]

export function LandingPage() {
  const [stars, setStars] = useState<number | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch("https://api.github.com/repos/iameterna00/instaxagent")
      .then(r => r.json())
      .then(d => { if (typeof d.stargazers_count === "number") setStars(d.stargazers_count) })
      .catch(() => {})
  }, [])

  const handleLogin = () => {
    // Instagram Business Login (Instagram API with Instagram Login). client_id must be the
    // Instagram app ID from the Instagram product page, not the parent Meta app ID.
    // manage_insights powers view/reach counts in the Content Studio; accounts that
    // logged in before it was added must reconnect for those numbers to appear.
    const scope = [
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
    ].join(",")
    window.location.href = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID}&redirect_uri=${process.env.NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI}&response_type=code&scope=${encodeURIComponent(scope)}`
  }

  const handleTestLogin = () => {
    localStorage.setItem("ig_user_id", "9999999999")
    localStorage.setItem("ig_username", "anuzz.joshi")
    router.push("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .marquee-track { animation: marquee 38s linear infinite; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fade-up .6s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track, .fade-up { animation: none; }
        }
      `}</style>

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
              <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">InstaxAgent</span>
            <span className="hidden rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-block">
              open source
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle className="mr-1" />
            <a
              href={GITHUB_URL} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Star</span>
              {stars !== null && <span className="numeric text-foreground">{stars}</span>}
            </a>
            {process.env.NODE_ENV === "development" && (
              <button
                onClick={handleTestLogin}
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Dev login
              </button>
            )}
            <button
              onClick={handleLogin}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Log in
            </button>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pb-20 pt-20 md:px-8 md:pt-28">
          <div className="fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-[13px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Self-hosted · No monthly fees
            </span>
          </div>

          <h1
            className="fade-up mt-7 max-w-3xl text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.03em] md:text-7xl"
            style={{ animationDelay: "60ms" }}
          >
            Your Instagram DMs,
            <br />
            <span className="text-muted-foreground">on autopilot.</span>
          </h1>

          <p
            className="fade-up mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:text-base"
            style={{ animationDelay: "120ms" }}
          >
            Comment-to-DM funnels, keyword triggers, story reactions, AI replies, a live inbox,
            and Reels scheduling. The open-source ManyChat alternative — your data stays in your
            own Supabase.
          </p>

          <div className="fade-up mt-9 flex flex-wrap items-center gap-3" style={{ animationDelay: "180ms" }}>
            <button
              onClick={handleLogin}
              className="group flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Connect Instagram
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            {process.env.NODE_ENV === "development" && (
              <button
                onClick={handleTestLogin}
                className="flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Terminal className="h-4 w-4" />
                Dev login
              </button>
            )}
            <a
              href={GITHUB_URL} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              View source
            </a>
          </div>
        </section>

        {/* Marquee */}
        <div className="overflow-hidden border-y border-border bg-muted/30 py-3">
          <div className="marquee-track flex w-max gap-6 whitespace-nowrap text-[13px] text-muted-foreground">
            {Array.from({ length: 2 }).map((_, copy) => (
              <div key={copy} className="flex gap-6">
                {MARQUEE_ITEMS.map((t) => (
                  <span key={t} className="flex items-center gap-6">
                    {t}
                    <span className="text-border">/</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Feature grid */}
        <section className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-24">
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-3">Features</p>
              <h2 className="max-w-lg text-3xl font-semibold tracking-tight md:text-4xl">
                Everything the paid tools do.
              </h2>
            </div>
            <span className="text-sm text-muted-foreground">$0 / month</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/50"
              >
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </div>
                <h3 className="mb-1.5 text-sm font-medium">{title}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Community strip */}
        <section className="mx-auto max-w-6xl px-5 pb-24 md:px-8">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-card p-8 md:flex-row md:items-center md:p-12">
            <div>
              <h3 className="mb-2 text-2xl font-semibold tracking-tight md:text-3xl">Built in the open.</h3>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                Every line is readable, forkable, and yours to run. Questions, bugs, feature
                requests — open an issue on GitHub.
              </p>
            </div>
            <a
              href={GITHUB_URL} target="_blank" rel="noreferrer"
              className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Star className="h-4 w-4" />
              Star on GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-[13px] text-muted-foreground md:flex-row md:px-8">
          <span>InstaxAgent — open-source Instagram automation. MIT licensed.</span>
          <div className="flex items-center gap-5">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">GitHub</a>
            <a href="/privacy" className="transition-colors hover:text-foreground">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
