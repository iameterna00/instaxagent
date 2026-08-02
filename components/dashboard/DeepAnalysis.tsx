"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Loader2, Sparkles, AlertTriangle, Search, ChevronDown, ChevronUp, Film, RefreshCw,
    Eye, Users, Activity, TrendingUp,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
    accountAverages, accountTotals, averageScore, band, compact, compareToAverage, engagementRate,
    formatLeaderboard, formatOf, scoreBands, BAND_LABEL,
} from "@/lib/ai/analysis"
import type { AnalysisSummary, AnalyzedPost, Band, PostFormat } from "@/lib/ai/analysis"
import type { AccountSnapshot } from "@/lib/instagram-account"

interface SavedAnalysis {
    id: string
    provider: string | null
    model: string | null
    summary: AnalysisSummary | null
    posts: AnalyzedPost[]
    posts_analyzed: number
    /** Follower count / reach the analysis was reasoned against. */
    account: AccountSnapshot | null
    has_insights: boolean
    created_at: string
}

const BAND_TEXT: Record<Band, string> = {
    top: "text-emerald-500",
    average: "text-muted-foreground",
    under: "text-amber-500",
}

const BAND_BAR: Record<Band, string> = {
    top: "bg-emerald-500",
    average: "bg-muted-foreground",
    under: "bg-amber-500",
}

const TONE_TEXT = {
    up: "text-emerald-500",
    down: "text-amber-500",
    flat: "text-muted-foreground",
} as const

const TONE_BAR = {
    up: "bg-emerald-500",
    down: "bg-amber-500",
    flat: "bg-muted-foreground",
} as const

/**
 * `.eyebrow` is declared outside Tailwind's layers, so its own color and size
 * win over utilities placed alongside it. Compose from this instead whenever
 * either needs overriding.
 */
const EYEBROW = "text-[11px] font-medium uppercase tracking-wider"

/** Post, Views, [Reach, Likes, Saves, Comm, ER], Score, chevron. */
const GRID =
    "grid items-center gap-3 grid-cols-[minmax(0,1fr)_64px_84px_24px] " +
    "lg:grid-cols-[minmax(0,1fr)_76px_76px_76px_64px_64px_60px_96px_24px]"

const WIDE_CELL = "hidden lg:block text-right numeric text-[13px] text-muted-foreground"

/** Captions are the only title Instagram gives us — take the first meaningful line. */
function titleOf(post: AnalyzedPost): string {
    const caption = (post.caption ?? "").trim()
    if (!caption) return "(no caption)"
    const firstLine = caption.split("\n").find((l) => l.trim().length > 0) ?? caption
    return firstLine.trim().slice(0, 90)
}

function dateOf(post: AnalyzedPost): string {
    if (!post.timestamp) return "unknown date"
    return new Date(post.timestamp).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
    })
}

function metric(value: number | undefined): string {
    return value === undefined ? "—" : compact(value)
}

// ------------------------------------------------------------

function StatCard({ label, icon: Icon, value, note }: {
    label: string
    icon: typeof Eye
    value: string
    note?: string
}) {
    return (
        <div className="surface flex flex-col gap-2.5 p-4">
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span>{label}</span>
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            </div>
            <span className="numeric text-[26px] font-semibold text-foreground">{value}</span>
            <span className="text-[12px] text-muted-foreground">{note ?? " "}</span>
        </div>
    )
}

function Bullets({ items, tone }: { items: string[]; tone: "up" | "down" }) {
    return (
        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted-foreground">
            {items.map((item, i) => (
                <div key={i} className="flex gap-2.5">
                    <span
                        className={cn(
                            "mt-[7px] h-1 w-1 shrink-0 rounded-full",
                            tone === "up" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                    />
                    <span>{item}</span>
                </div>
            ))}
        </div>
    )
}

function SummaryPanel({ summary }: { summary: AnalysisSummary }) {
    return (
        <div className="surface flex flex-col gap-4 p-5 md:p-6">
            <div className="flex items-center gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                    <Sparkles className="h-3 w-3" strokeWidth={2.2} />
                </div>
                <span className="eyebrow">AI summary</span>
            </div>

            {summary.headline && (
                <p className="max-w-[62ch] text-pretty text-[17px] leading-relaxed tracking-tight text-foreground">
                    {summary.headline}
                </p>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
                {summary.what_is_working.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                        <span className={cn(EYEBROW, "text-emerald-500")}>What&apos;s working</span>
                        <Bullets items={summary.what_is_working} tone="up" />
                    </div>
                )}
                {summary.what_to_improve.length > 0 && (
                    <div className="flex flex-col gap-2.5">
                        <span className={cn(EYEBROW, "text-amber-500")}>What to improve</span>
                        <Bullets items={summary.what_to_improve} tone="down" />
                    </div>
                )}
            </div>

            {summary.next_post && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:gap-4">
                    <span className="eyebrow shrink-0 sm:pt-0.5">Next post</span>
                    <p className="text-[13px] leading-relaxed text-foreground">{summary.next_post}</p>
                </div>
            )}
        </div>
    )
}

function ScorePanel({ posts }: { posts: AnalyzedPost[] }) {
    const score = averageScore(posts)
    const bands = scoreBands(posts)
    const leaderboard = formatLeaderboard(posts)
    const scored = bands.top + bands.average + bands.under

    return (
        <div className="surface flex flex-col gap-4 p-5 md:p-6">
            <span className="eyebrow">Content score</span>

            <div className="flex items-baseline gap-2.5">
                <span className="numeric text-[42px] font-semibold leading-none text-foreground">{score}</span>
                <span className="text-[15px] text-muted-foreground">/ 100 avg</span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${score}%` }} />
            </div>

            {scored > 0 && (
                <div className="flex gap-1.5 text-[11px]">
                    {bands.top > 0 && (
                        <span
                            className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-center text-emerald-500"
                            style={{ flex: bands.top }}
                        >
                            {bands.top} top
                        </span>
                    )}
                    {bands.average > 0 && (
                        <span
                            className="rounded-md bg-muted px-2 py-1.5 text-center text-muted-foreground"
                            style={{ flex: bands.average }}
                        >
                            {bands.average} average
                        </span>
                    )}
                    {bands.under > 0 && (
                        <span
                            className="rounded-md bg-amber-500/10 px-2 py-1.5 text-center text-amber-500"
                            style={{ flex: bands.under }}
                        >
                            {bands.under} under
                        </span>
                    )}
                </div>
            )}

            {leaderboard.length > 0 && (
                <>
                    <div className="h-px bg-border" />
                    <span className="eyebrow">Format leaderboard</span>
                    <div className="flex flex-col gap-3">
                        {leaderboard.map((row) => (
                            <div key={row.format} className="flex flex-col gap-1.5">
                                <div className="flex justify-between text-[13px]">
                                    <span className="text-foreground">
                                        {row.format[0] + row.format.slice(1).toLowerCase()}s · {row.count}{" "}
                                        {row.count === 1 ? "post" : "posts"}
                                    </span>
                                    <span className="numeric text-muted-foreground">avg {row.avgScore}</span>
                                </div>
                                <div className="h-1 rounded-full bg-muted">
                                    <div
                                        className={cn("h-full rounded-full", BAND_BAR[band(row.avgScore)])}
                                        style={{ width: `${row.avgScore}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

// ------------------------------------------------------------

type SortKey = "views" | "reach" | "likes" | "er" | "score"

const SORTS: { key: SortKey; label: string }[] = [
    { key: "views", label: "Views" },
    { key: "reach", label: "Reach" },
    { key: "likes", label: "Likes" },
    { key: "er", label: "ER" },
    { key: "score", label: "Score" },
]

const FORMATS: (PostFormat | "ALL")[] = ["ALL", "REEL", "CAROUSEL", "STATIC", "STORY"]

function PostRow({ post, averages, open, onToggle }: {
    post: AnalyzedPost
    averages: Record<string, number>
    open: boolean
    onToggle: () => void
}) {
    const verdict = post.analysis
    const tone = verdict ? band(verdict.score) : "average"
    const er = engagementRate(post)
    const thumb = post.thumbnail_url || post.media_url
    const comparisons = useMemo(() => compareToAverage(post, averages), [post, averages])

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={cn(GRID, "w-full px-4 py-3 text-left transition-colors hover:bg-muted/40 md:px-5")}
            >
                {/* Post */}
                <div className="flex min-w-0 items-center gap-3">
                    <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                        {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <Film className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        )}
                        <span className="absolute bottom-0.5 left-0.5 rounded-[3px] bg-black/70 px-1 py-px text-[7px] font-medium tracking-wide text-white">
                            {formatOf(post)}
                        </span>
                    </div>

                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[13px] font-medium text-foreground">{titleOf(post)}</span>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="truncate">{dateOf(post)}</span>
                            {verdict && (
                                <>
                                    <span className="opacity-40">·</span>
                                    <span className={cn("shrink-0 font-medium", BAND_TEXT[tone])}>
                                        {BAND_LABEL[tone]}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <span className="numeric text-right text-[13px] font-medium text-foreground">
                    {metric(post.views)}
                </span>
                <span className={WIDE_CELL}>{metric(post.reach)}</span>
                <span className={WIDE_CELL}>{metric(post.like_count)}</span>
                <span className={WIDE_CELL}>{metric(post.saved)}</span>
                <span className={WIDE_CELL}>{metric(post.comments_count)}</span>
                <span className={WIDE_CELL}>{er === undefined ? "—" : `${(er * 100).toFixed(1)}%`}</span>

                {/* AI score */}
                <div className="flex items-center justify-end gap-2">
                    {verdict ? (
                        <>
                            <div className="hidden h-1 w-8 overflow-hidden rounded-full bg-muted sm:block">
                                <div
                                    className={cn("h-full rounded-full", BAND_BAR[tone])}
                                    style={{ width: `${verdict.score}%` }}
                                />
                            </div>
                            <span className={cn("numeric text-[13px] font-semibold", BAND_TEXT[tone])}>
                                {verdict.score}
                            </span>
                        </>
                    ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                </div>

                <span className="flex justify-end text-muted-foreground">
                    {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
            </button>

            {open && verdict && (
                <div className="bg-muted/20 px-4 pb-5 md:px-5 lg:pl-20">
                    <div className="grid gap-6 rounded-xl border border-border bg-card p-4 md:p-5 lg:grid-cols-[1.35fr_1fr]">
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-foreground text-background">
                                    <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                                </div>
                                <span className="eyebrow">Post analysis</span>
                                {verdict.verdict && (
                                    <span className="text-[12px] text-muted-foreground">· {verdict.verdict}</span>
                                )}
                            </div>

                            <div className="grid gap-5 sm:grid-cols-2">
                                {verdict.working.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-emerald-500")}>Working</span>
                                        <Bullets items={verdict.working} tone="up" />
                                    </div>
                                )}
                                {verdict.improve.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-amber-500")}>To improve</span>
                                        <Bullets items={verdict.improve} tone="down" />
                                    </div>
                                )}
                            </div>

                            {verdict.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {verdict.tags.map((tag, i) => (
                                        <span
                                            key={i}
                                            className="numeric rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] tracking-wide text-muted-foreground"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {verdict.next && (
                                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/50 p-3.5 sm:flex-row sm:gap-3.5">
                                    <span className="eyebrow shrink-0 sm:pt-0.5">Do next</span>
                                    <p className="text-[13px] leading-relaxed text-foreground">{verdict.next}</p>
                                </div>
                            )}

                            {post.permalink && (
                                <a
                                    href={post.permalink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[12px] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                                >
                                    View on Instagram
                                </a>
                            )}
                        </div>

                        <div className="flex flex-col gap-3.5 lg:border-l lg:border-border lg:pl-6">
                            {comparisons.length > 0 && (
                                <>
                                    <span className="eyebrow">vs. your average</span>
                                    <div className="flex flex-col gap-2.5">
                                        {comparisons.map((row) => (
                                            <div key={row.label} className="flex flex-col gap-1.5">
                                                <div className="flex justify-between text-[12px]">
                                                    <span className="text-muted-foreground">{row.label}</span>
                                                    <span className={cn("numeric font-semibold", TONE_TEXT[row.tone])}>
                                                        {row.delta}
                                                    </span>
                                                </div>
                                                <div className="h-1 rounded-full bg-muted">
                                                    <div
                                                        className={cn("h-full rounded-full", TONE_BAR[row.tone])}
                                                        style={{ width: `${row.pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {verdict.lift && (
                                <>
                                    <div className="h-px bg-border" />
                                    <div className="flex flex-col gap-1.5">
                                        <span className="eyebrow">Predicted lift if fixed</span>
                                        <span className="numeric text-[22px] font-semibold text-emerald-500">
                                            {verdict.lift}
                                        </span>
                                        {verdict.lift_note && (
                                            <span className="text-[12px] leading-relaxed text-muted-foreground">
                                                {verdict.lift_note}
                                            </span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ------------------------------------------------------------

export function DeepAnalysis({ userId }: { userId: string }) {
    const [saved, setSaved] = useState<SavedAnalysis | null>(null)
    const [loading, setLoading] = useState(true)
    const [running, setRunning] = useState(false)

    const [search, setSearch] = useState("")
    const [format, setFormat] = useState<PostFormat | "ALL">("ALL")
    const [sort, setSort] = useState<SortKey>("views")
    const [open, setOpen] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/ai/analysis?userId=${userId}`)
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return
                if (data && !data.error) setSaved(data)
            })
            .catch(() => { })
            .finally(() => !cancelled && setLoading(false))
        return () => { cancelled = true }
    }, [userId])

    const run = useCallback(async () => {
        setRunning(true)
        try {
            const res = await fetch("/api/ai/analysis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Analysis failed")
            setSaved(data)
            setOpen(null)
            toast.success(`Analysed ${data.posts_analyzed} posts`)
        } catch (e: any) {
            toast.error(e.message || "Analysis failed")
        } finally {
            setRunning(false)
        }
    }, [userId])

    const posts = useMemo(() => saved?.posts ?? [], [saved])
    const account = saved?.account ?? null
    const averages = useMemo(() => accountAverages(posts), [posts])
    const totals = useMemo(() => accountTotals(posts, account), [posts, account])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()

        const filtered = posts.filter((post) => {
            if (format !== "ALL" && formatOf(post) !== format) return false
            if (!needle) return true
            return (post.caption ?? "").toLowerCase().includes(needle)
        })

        const rank = (post: AnalyzedPost): number => {
            switch (sort) {
                case "views": return post.views ?? -1
                case "reach": return post.reach ?? -1
                case "likes": return post.like_count ?? -1
                case "er": return engagementRate(post) ?? -1
                case "score": return post.analysis?.score ?? -1
            }
        }

        return [...filtered].sort((a, b) => rank(b) - rank(a))
    }, [posts, search, format, sort])

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Nothing generated yet — the whole page is one call away.
    if (!saved) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-20 text-center">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                    <Sparkles className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h2 className="text-base font-medium text-foreground">Analyse your last 25 posts</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    Scores every post against the rest of your account and tells you what worked,
                    what didn&apos;t, and what to post next.
                </p>
                <button
                    onClick={run}
                    disabled={running}
                    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                    {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {running ? "Analysing…" : "Run AI analysis"}
                </button>
                {running && (
                    <p className="mt-3 text-[12px] text-muted-foreground">
                        This reads every post and can take a minute or two.
                    </p>
                )}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-muted-foreground">
                    {saved.posts_analyzed} posts analysed ·{" "}
                    {new Date(saved.created_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {saved.model && ` · ${saved.model}`}
                </p>
                <button
                    onClick={run}
                    disabled={running}
                    className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                    {running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {running ? "Analysing…" : "Re-run AI analysis"}
                </button>
            </div>

            {!saved.has_insights && (
                <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-[12px] text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        No view or reach numbers came back, so this analysis rests on captions, formats and
                        likes alone. To fix it, both steps are needed:
                        <span className="mt-1.5 block">
                            1. In your Meta app dashboard → Instagram API → Customize use case, add the{" "}
                            <code className="text-foreground">instagram_business_manage_insights</code> permission.
                        </span>
                        <span className="mt-0.5 block">
                            2. Log out and reconnect Instagram so the new token carries it, then re-run.
                        </span>
                    </span>
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    label="Views"
                    icon={Eye}
                    value={metric(totals.views)}
                    note={`across ${totals.measured} measured posts`}
                />
                <StatCard
                    label="Reach"
                    icon={Users}
                    value={metric(totals.reach)}
                    note={account?.profile.followers_count
                        ? `${compact(account.profile.followers_count)} followers`
                        : undefined}
                />
                <StatCard
                    label="Engagement rate"
                    icon={Activity}
                    value={totals.engagementRate === undefined
                        ? "—"
                        : `${(totals.engagementRate * 100).toFixed(1)}%`}
                    note="interactions over reach"
                />
                <StatCard
                    label="Followers gained"
                    icon={TrendingUp}
                    value={totals.netFollows === undefined
                        ? "—"
                        : `${totals.netFollows > 0 ? "+" : ""}${compact(totals.netFollows)}`}
                    note={account?.insights?.window_days
                        ? `last ${account.insights.window_days} days`
                        : "not reported"}
                />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
                {saved.summary && <SummaryPanel summary={saved.summary} />}
                <ScorePanel posts={posts} />
            </div>

            {/* Filters */}
            <div className="surface flex flex-wrap items-center gap-2 p-2.5">
                <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search caption or #hashtag"
                        className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </div>

                <div className="flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
                    {FORMATS.map((option) => (
                        <button
                            key={option}
                            onClick={() => setFormat(option)}
                            className={cn(
                                "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                                format === option
                                    ? "bg-muted font-medium text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {option === "ALL" ? "All" : option[0] + option.slice(1).toLowerCase() + "s"}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">Sort</span>
                    <div className="flex gap-0.5 rounded-lg border border-border bg-background p-0.5">
                        {SORTS.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => setSort(option.key)}
                                className={cn(
                                    "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                                    sort === option.key
                                        ? "bg-foreground font-medium text-background"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="surface overflow-hidden">
                <div
                    className={cn(
                        GRID,
                        EYEBROW,
                        "border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] text-muted-foreground md:px-5",
                    )}
                >
                    <span>Post</span>
                    <span className="text-right">Views</span>
                    <span className="hidden text-right lg:block">Reach</span>
                    <span className="hidden text-right lg:block">Likes</span>
                    <span className="hidden text-right lg:block">Saves</span>
                    <span className="hidden text-right lg:block">Comm.</span>
                    <span className="hidden text-right lg:block">ER</span>
                    <span className="text-right">AI score</span>
                    <span />
                </div>

                {visible.length === 0 ? (
                    <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                        No posts match those filters.
                    </p>
                ) : (
                    visible.map((post, i) => {
                        const key = post.id ?? String(i)
                        return (
                            <PostRow
                                key={key}
                                post={post}
                                averages={averages}
                                open={open === key}
                                onToggle={() => setOpen(open === key ? null : key)}
                            />
                        )
                    })
                )}

                {visible.length > 0 && (
                    <div className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
                        Showing {visible.length} of {posts.length} posts
                    </div>
                )}
            </div>
        </div>
    )
}
