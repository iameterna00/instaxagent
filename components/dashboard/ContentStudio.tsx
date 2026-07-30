"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Loader2, Wand2, Copy, Check, Trash2, ChevronDown, Target, History, AlertTriangle, Eye, Film, Users, Mic,
    LayoutGrid,
} from "lucide-react"
import { archetypeLabel, pillarSpread } from "@/lib/ai/content"
import type { ContentIdea, ContentAnalysis, OwnPost } from "@/lib/ai/content"
import type { AccountSnapshot } from "@/lib/instagram-account"

interface ContentPlan {
    id: string
    goal: string
    niche: string | null
    audience: string | null
    formats: string[]
    reference_notes: string | null
    provider: string | null
    model: string | null
    analysis: ContentAnalysis | null
    ideas: ContentIdea[]
    posts: OwnPost[] | null
    posts_analyzed: number
    /** Follower count / reach / demographics the plan was reasoned against. */
    account: AccountSnapshot | null
    transcripts_used: number
    created_at: string
}

function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
    return String(n)
}

/** The posts the plan was built from — highest reach first, so the evidence is visible. */
function AnalyzedPosts({ posts }: { posts: OwnPost[] }) {
    const [expanded, setExpanded] = useState(false)
    const hasViews = posts.some(p => p.views !== undefined || p.reach !== undefined)

    const ranked = [...posts].sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0))
    const shown = expanded ? ranked : ranked.slice(0, 8)

    return (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className={label}>
                    {hasViews ? "Your posts, best performing first" : "Posts it read"}
                </span>
                <span className="text-[10px] text-muted-foreground">{posts.length} analysed</span>
            </div>

            {!hasViews && (
                <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>
                        No view or reach numbers came back, so this plan was built from captions and formats only. To fix
                        it, both steps are needed:
                        <span className="block mt-1.5 text-muted-foreground">
                            1. In your Meta app dashboard → Instagram API → Customize use case, add the{" "}
                            <code className="text-foreground">instagram_business_manage_insights</code> permission.
                        </span>
                        <span className="block mt-0.5 text-muted-foreground">
                            2. Log out and reconnect Instagram so the new token carries it, then regenerate.
                        </span>
                    </span>
                </div>
            )}

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {shown.map((post, i) => {
                    const thumb = post.thumbnail_url || post.media_url
                    const metric = post.views ?? post.reach
                    return (
                        <a
                            key={post.id ?? i}
                            href={post.permalink}
                            target="_blank"
                            rel="noreferrer"
                            title={post.caption?.slice(0, 160) || "View on Instagram"}
                            className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/60 hover:border-foreground/40 transition-colors"
                        >
                            {thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Film className="w-4 h-4 text-muted-foreground" />
                                </div>
                            )}

                            {post.media_product_type === "REELS" && (
                                <Film className="absolute top-1.5 right-1.5 w-3 h-3 text-foreground drop-shadow" />
                            )}

                            {metric !== undefined && (
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1.5">
                                    <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground">
                                        <Eye className="w-2.5 h-2.5" />
                                        {compact(metric)}
                                    </span>
                                </div>
                            )}
                        </a>
                    )
                })}
            </div>

            {ranked.length > 8 && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    {expanded ? "Show less" : `Show all ${ranked.length}`}
                </button>
            )}
        </div>
    )
}

/**
 * The audience the plan was sized against. Shown alongside the plan because
 * "5k views" only means something next to a follower count.
 */
function AudienceCard({ account, transcriptsUsed }: { account: AccountSnapshot; transcriptsUsed: number }) {
    const { profile, insights, demographics } = account
    const followers = profile.followers_count

    const stats: { label: string; value: string; hint?: string }[] = []
    if (followers !== undefined) stats.push({ label: "Followers", value: compact(followers) })
    if (insights?.reach !== undefined) {
        stats.push({
            label: `Reach · ${insights.window_days}d`,
            value: compact(insights.reach),
            hint: followers ? `${(insights.reach / followers).toFixed(1)}× followers` : undefined,
        })
    }
    if (insights?.net_follows !== undefined) {
        const perWeek = (insights.net_follows / (insights.window_days || 30)) * 7
        stats.push({
            label: "Net new followers",
            value: `${insights.net_follows > 0 ? "+" : ""}${compact(insights.net_follows)}`,
            hint: `≈${perWeek > 0 ? "+" : ""}${perWeek.toFixed(0)}/week`,
        })
    }
    if (insights?.accounts_engaged !== undefined) {
        stats.push({
            label: "Accounts engaged",
            value: compact(insights.accounts_engaged),
            hint: insights.reach ? `${Math.round((insights.accounts_engaged / insights.reach) * 100)}% of reach` : undefined,
        })
    }

    const topSlices = (slices?: { key: string; value: number }[]) => {
        if (!slices?.length) return null
        const total = slices.reduce((sum, s) => sum + s.value, 0) || 1
        return slices.slice(0, 3).map(s => `${s.key} ${Math.round((s.value / total) * 100)}%`).join(" · ")
    }

    const rows = [
        { label: "Age", value: topSlices(demographics?.age) },
        { label: "Country", value: topSlices(demographics?.country) },
        { label: "Gender", value: topSlices(demographics?.gender) },
    ].filter(r => r.value)

    // Notes alone are worth a card — they say what the API refused and how to fix it.
    if (!stats.length && !rows.length && !transcriptsUsed && !account.notes?.length) return null

    return (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className={`${label} flex items-center gap-2`}>
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    The audience this plan was built for
                </span>
                {transcriptsUsed > 0 && (
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Mic className="w-3 h-3" />
                        {transcriptsUsed} reel{transcriptsUsed === 1 ? "" : "s"} transcribed
                    </span>
                )}
            </div>

            {stats.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {stats.map(stat => (
                        <div key={stat.label} className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
                            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                            <p className="numeric text-sm font-medium text-foreground mt-0.5">{stat.value}</p>
                            {stat.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{stat.hint}</p>}
                        </div>
                    ))}
                </div>
            )}

            {rows.length > 0 && (
                <div className="space-y-1.5">
                    {rows.map(row => (
                        <p key={row.label} className="text-[11px] text-muted-foreground">
                            <span className="text-foreground">{row.label}:</span> {row.value}
                        </p>
                    ))}
                </div>
            )}

            {(account.notes?.length ?? 0) > 0 && (
                <div className="space-y-1 border-t border-border pt-3">
                    {account.notes.map((note, i) => (
                        <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            {note}
                        </p>
                    ))}
                </div>
            )}
        </div>
    )
}

/**
 * The topical spread of the set. Surfaced because a plan whose ideas all sit in
 * one pillar is ten versions of the same video, and that is easy to miss when
 * each idea reads fine on its own.
 */
function PillarSpread({ ideas, pillars }: { ideas: ContentIdea[]; pillars: string[] }) {
    if (!ideas.length) return null

    const { pillars: distinct, largestShare } = pillarSpread(ideas)
    const named = pillars.length ? pillars : []
    if (!named.length && distinct <= 1) return null

    const counts = named.map(p => ({
        name: p,
        count: ideas.filter(i => i.pillar?.trim().toLowerCase() === p.trim().toLowerCase()).length,
    }))

    // Same thresholds the prompt is held to: 3+ ideas should span 3+ pillars,
    // and no single pillar may hold more than half the set.
    const tooNarrow = ideas.length >= 3 && (distinct < 3 || largestShare > 0.5)

    return (
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className={`${label} flex items-center gap-2`}>
                    <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
                    Content pillars
                </span>
                <span className="text-[10px] text-muted-foreground">
                    {distinct} across {ideas.length} idea{ideas.length === 1 ? "" : "s"}
                </span>
            </div>

            {counts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {counts.map(p => (
                        <span
                            key={p.name}
                            className="rounded-lg border border-border bg-background/40 px-2.5 py-1 text-[11px] text-foreground"
                        >
                            {p.name}
                            <span className="numeric ml-1.5 text-muted-foreground">{p.count}</span>
                        </span>
                    ))}
                </div>
            )}

            {tooNarrow && (
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    These ideas are bunched into too few subjects, so they will reach much the same people
                    twice. Regenerate, or add the angles you actually want to the goal box.
                </p>
            )}
        </div>
    )
}

const FORMATS = ["reel", "carousel", "story", "post"]

const label = "text-[13px] font-medium text-foreground"
const field =
    "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none"

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            onClick={() => {
                navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
            }}
            className={`text-muted-foreground hover:text-foreground transition-colors ${className}`}
            title="Copy"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    )
}

function IdeaCard({ idea, index }: { idea: ContentIdea; index: number }) {
    const [open, setOpen] = useState(index === 0)
    const archetype = archetypeLabel(idea.hook_archetype)

    const fullText = [
        archetype ? `ARCHETYPE: ${archetype}` : "",
        `HOOK: ${idea.hook}`,
        "",
        "SCRIPT:",
        ...idea.script.map((beat, i) => `${i + 1}. ${beat}`),
        "",
        idea.caption ? `CAPTION:\n${idea.caption}` : "",
        idea.cta ? `\nCTA: ${idea.cta}` : "",
        idea.hashtags?.length ? `\n${idea.hashtags.map(h => `#${h}`).join(" ")}` : "",
    ].filter(Boolean).join("\n")

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-start gap-3 p-5 text-left hover:bg-muted/60 transition-colors"
            >
                <span className="numeric mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {idea.format}
                        </span>
                        {archetype && (
                            <span
                                title="Hook archetype this idea is built on"
                                className="rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                            >
                                {archetype}
                            </span>
                        )}
                        <span className="text-foreground font-medium text-sm">{idea.title}</span>
                    </div>
                    {idea.pillar && (
                        <p className="text-[11px] text-muted-foreground mt-1.5">{idea.pillar}</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2 italic">&ldquo;{idea.hook}&rdquo;</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
                    {idea.why_it_works && (
                        <p className="text-xs text-muted-foreground">
                            <span className="text-muted-foreground">Why:</span> {idea.why_it_works}
                        </p>
                    )}

                    {idea.script.length > 0 && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className={label}>Script</span>
                                <CopyButton text={idea.script.map((b, i) => `${i + 1}. ${b}`).join("\n")} />
                            </div>
                            <ol className="space-y-2">
                                {idea.script.map((beat, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-foreground">
                                        <span className="numeric mt-0.5 shrink-0 text-[11px] text-muted-foreground">{i + 1}</span>
                                        <span>{beat}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {idea.caption && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className={label}>Caption</span>
                                <CopyButton text={idea.caption} />
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap bg-background/40 rounded-xl p-4 border border-border">
                                {idea.caption}
                            </p>
                        </div>
                    )}

                    <div className="flex items-end justify-between gap-4 flex-wrap">
                        <div className="space-y-2">
                            {idea.cta && (
                                <p className="text-xs text-muted-foreground">
                                    <span className={label}>CTA</span> <span className="ml-2">{idea.cta}</span>
                                </p>
                            )}
                            {idea.hashtags && idea.hashtags.length > 0 && (
                                <p className="text-xs text-muted-foreground">{idea.hashtags.map(h => `#${h}`).join(" ")}</p>
                            )}
                        </div>
                        <button
                            onClick={() => navigator.clipboard.writeText(fullText)}
                            className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <Copy className="w-3 h-3" /> Copy all
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export function ContentStudio({ userId }: { userId: string }) {
    const [goal, setGoal] = useState("")
    const [niche, setNiche] = useState("")
    const [audience, setAudience] = useState("")
    const [formats, setFormats] = useState<string[]>(["reel"])
    const [ideaCount, setIdeaCount] = useState(5)
    const [referenceNotes, setReferenceNotes] = useState("")

    const [generating, setGenerating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [checking, setChecking] = useState(false)
    const [check, setCheck] = useState<{
        ok: boolean
        reason: string
        sample?: { views?: number; reach?: number }
        reelsFound?: number
        followersCount?: number
        canTranscribe?: boolean
    } | null>(null)
    const [plan, setPlan] = useState<ContentPlan | null>(null)
    const [history, setHistory] = useState<ContentPlan[]>([])
    const [showHistory, setShowHistory] = useState(false)

    const loadHistory = useCallback(async () => {
        if (!userId) return
        try {
            const res = await fetch(`/api/ai/content?userId=${userId}`)
            const data = await res.json()
            if (Array.isArray(data)) setHistory(data)
        } catch { /* history is a nicety — don't surface */ }
    }, [userId])

    useEffect(() => { loadHistory() }, [loadHistory])

    const toggleFormat = (f: string) =>
        setFormats(prev => (prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]))

    const generate = async () => {
        if (!goal.trim() || generating) return
        setGenerating(true)
        setError(null)
        try {
            const res = await fetch("/api/ai/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, goal, niche, audience, formats, referenceNotes, ideaCount }),
            })
            const data = await res.json()
            if (!res.ok) setError(data?.error || "Generation failed")
            else {
                setPlan(data)
                setShowHistory(false)
                loadHistory()
            }
        } catch {
            setError("Generation failed — check your connection and try again")
        } finally {
            setGenerating(false)
        }
    }

    const runCheck = async () => {
        setChecking(true)
        setCheck(null)
        try {
            const res = await fetch(`/api/ai/content/check?userId=${userId}`)
            const data = await res.json()
            setCheck({
                ok: Boolean(data.ok),
                reason: data.reason || data.error || "Check failed",
                sample: data.sample,
                reelsFound: data.reelsFound,
                followersCount: data.followersCount,
                canTranscribe: data.canTranscribe,
            })
        } catch {
            setCheck({ ok: false, reason: "Check failed — could not reach the server" })
        } finally {
            setChecking(false)
        }
    }

    const remove = async (id: string) => {
        await fetch(`/api/ai/content?id=${id}`, { method: "DELETE" })
        if (plan?.id === id) setPlan(null)
        loadHistory()
    }

    return (
        <div className="space-y-8">
            {/* Brief */}
            <div className="space-y-5 rounded-xl border border-border bg-card p-5 md:p-6">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                        <Target className="h-4 w-4" strokeWidth={1.8} />
                    </div>
                    <div>
                        <h2 className="text-sm font-medium text-foreground">What are you trying to achieve?</h2>
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                            The studio reads your last 25 posts, transcribes your reels, and sizes the plan against your
                            follower count — not generic advice.
                        </p>
                    </div>
                </div>

                <textarea
                    value={goal}
                    onChange={e => setGoal(e.target.value)}
                    rows={3}
                    placeholder="e.g. Get to 10k followers in 3 months and fill 5 coaching slots a month. Right now I post workout clips that get views but nobody DMs me."
                    className={`${field} resize-y leading-relaxed`}
                />

                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <span className={label}>Niche</span>
                        <input
                            value={niche}
                            onChange={e => setNiche(e.target.value)}
                            placeholder="e.g. home fitness for busy parents"
                            className={`${field} mt-2`}
                        />
                    </div>
                    <div>
                        <span className={label}>Who it&apos;s for</span>
                        <input
                            value={audience}
                            onChange={e => setAudience(e.target.value)}
                            placeholder="e.g. 30-45, working, no gym time"
                            className={`${field} mt-2`}
                        />
                    </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                        <span className={label}>Formats</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {FORMATS.map(f => (
                                <button
                                    key={f}
                                    onClick={() => toggleFormat(f)}
                                    className={`px-3 h-9 rounded-lg text-xs font-medium border capitalize transition-colors ${
                                        formats.includes(f)
                                            ? "bg-muted border-foreground/40 text-foreground"
                                            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                                    }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <span className={label}>How many ideas</span>
                        <select
                            value={ideaCount}
                            onChange={e => setIdeaCount(Number(e.target.value))}
                            className={`${field} mt-2 appearance-none`}
                        >
                            {[3, 5, 8, 10].map(n => (
                                <option key={n} value={n} className="bg-card">{n} ideas</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <span className={label}>Accounts you want to learn from</span>
                    <textarea
                        value={referenceNotes}
                        onChange={e => setReferenceNotes(e.target.value)}
                        rows={3}
                        placeholder="Describe them — Instagram's API won't let this app read other people's posts, so tell it what they do. e.g. @someone posts 30s 'day in the life' reels with text-on-screen and a hard CTA at the end; @another does before/after carousels."
                        className={`${field} mt-2 resize-y leading-relaxed`}
                    />
                    <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        Competitor posts can&apos;t be fetched automatically on this login type — whatever you write here is
                        what it knows about them.
                    </p>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap pt-1">
                    <div className="text-xs">
                        {error ? (
                            <span className="text-destructive">{error}</span>
                        ) : (
                            <span className="text-muted-foreground">Uses the same API key as your AI agent.</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={runCheck}
                            disabled={checking}
                            title="Check that Instagram posts and insights are readable — costs no AI tokens"
                            className="flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                            Check access
                        </button>
                        {history.length > 0 && (
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className="flex h-9 items-center gap-2 rounded-lg border border-border px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                                <History className="w-3.5 h-3.5" />
                                {history.length}
                            </button>
                        )}
                        <button
                            onClick={generate}
                            disabled={generating || !goal.trim()}
                            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            {generating ? "Planning…" : "Generate"}
                        </button>
                    </div>
                </div>

                {generating && (
                    <p className="text-[11px] text-muted-foreground">
                        Reading your posts and thinking it through — this usually takes 30–90 seconds.
                    </p>
                )}

                {check && (
                    <div
                        className={`rounded-xl border px-4 py-3 text-xs flex items-start gap-2 ${
                            check.ok
                                ? "border-foreground/40 bg-muted text-foreground"
                                : "border-border bg-muted/60 text-muted-foreground"
                        }`}
                    >
                        {check.ok
                            ? <Check className="w-3.5 h-3.5 text-foreground mt-0.5 shrink-0" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />}
                        <span>
                            {check.reason}
                            {check.sample && (
                                <span className="block text-muted-foreground mt-1">
                                    Sample from your account: {check.sample.views !== undefined && `${compact(check.sample.views)} views`}
                                    {check.sample.views !== undefined && check.sample.reach !== undefined && " · "}
                                    {check.sample.reach !== undefined && `${compact(check.sample.reach)} reach`}
                                    {check.reelsFound !== undefined && ` · ${check.reelsFound} reel(s) in the last 3 posts`}
                                </span>
                            )}
                            <span className="block text-muted-foreground mt-1">
                                {check.followersCount !== undefined
                                    ? `${compact(check.followersCount)} followers visible`
                                    : "Follower count not visible"}
                                {" · "}
                                {check.canTranscribe ? "transcription ready" : "transcription not set up"}
                            </span>
                        </span>
                    </div>
                )}
            </div>

            {/* History */}
            {showHistory && (
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                    {history.map(item => (
                        <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-muted/60 transition-colors">
                            <button onClick={() => { setPlan(item); setShowHistory(false) }} className="flex-1 text-left min-w-0">
                                <p className="text-sm text-foreground truncate">{item.goal}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {new Date(item.created_at).toLocaleDateString()} · {item.ideas?.length ?? 0} ideas · {item.model}
                                </p>
                            </button>
                            <button onClick={() => remove(item.id)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Result */}
            {plan && (
                <div className="space-y-6">
                    {plan.account && (
                        <AudienceCard account={plan.account} transcriptsUsed={plan.transcripts_used ?? 0} />
                    )}

                    {plan.posts && plan.posts.length > 0 && <AnalyzedPosts posts={plan.posts} />}

                    {plan.analysis && (
                        <div className="rounded-2xl border border-foreground/40 bg-muted p-6 space-y-4">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <span className={label}>Read on your account</span>
                                <span className="text-[10px] text-muted-foreground">
                                    {plan.posts_analyzed} posts analysed
                                    {plan.transcripts_used > 0 && ` · ${plan.transcripts_used} transcribed`}
                                    {" · "}{plan.model}
                                </span>
                            </div>

                            {plan.analysis.niche && <p className="text-foreground text-sm font-medium">{plan.analysis.niche}</p>}
                            {plan.analysis.positioning && (
                                <p className="text-sm text-foreground leading-relaxed">{plan.analysis.positioning}</p>
                            )}

                            {/* Follower-aware reasoning: where they are, and the maths to the goal. */}
                            {(plan.analysis.scale || plan.analysis.growth_math || plan.analysis.voice) && (
                                <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
                                    {plan.analysis.scale && (
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Where you are</span>
                                            <p className="text-[13px] text-foreground leading-relaxed mt-1">{plan.analysis.scale}</p>
                                        </div>
                                    )}
                                    {plan.analysis.growth_math && (
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">What the goal requires</span>
                                            <p className="text-[13px] text-foreground leading-relaxed mt-1">{plan.analysis.growth_math}</p>
                                        </div>
                                    )}
                                    {plan.analysis.voice && (
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                                <Mic className="w-3 h-3" /> How you actually talk
                                            </span>
                                            <p className="text-[13px] text-foreground leading-relaxed mt-1">{plan.analysis.voice}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="grid sm:grid-cols-2 gap-5 pt-1">
                                {(plan.analysis.what_is_working?.length ?? 0) > 0 && (
                                    <div>
                                        <span className={label}>Working</span>
                                        <ul className="mt-2 space-y-1.5">
                                            {plan.analysis.what_is_working!.map((s, i) => (
                                                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                                                    <span className="text-foreground">+</span>{s}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {(plan.analysis.gaps?.length ?? 0) > 0 && (
                                    <div>
                                        <span className={label}>Gaps</span>
                                        <ul className="mt-2 space-y-1.5">
                                            {plan.analysis.gaps!.map((s, i) => (
                                                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                                                    <span className="text-muted-foreground">−</span>{s}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <PillarSpread ideas={plan.ideas} pillars={plan.analysis?.pillars ?? []} />

                    <div className="space-y-3">
                        {plan.ideas.map((idea, i) => <IdeaCard key={i} idea={idea} index={i} />)}
                    </div>
                </div>
            )}
        </div>
    )
}
