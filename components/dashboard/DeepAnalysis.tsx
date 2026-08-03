"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Loader2, Sparkles, AlertTriangle, Search, ChevronDown, ChevronUp, Film, RefreshCw,
    Download, Star,
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

const TONE_TEXT = { up: "text-emerald-500", down: "text-amber-500", flat: "text-muted-foreground" } as const
const TONE_BAR = { up: "bg-emerald-500", down: "bg-amber-500", flat: "bg-muted-foreground" } as const

/** The design's eyebrow: JetBrains Mono 10px, wide tracking, uppercase. */
const EYEBROW = "mono text-[10px] uppercase tracking-[0.1em]"

/** Chip shared by the search box, dropdowns and segmented controls. */
const CHIP = "rounded-[9px] border border-border bg-background"

/**
 * The design's column widths, verbatim:
 *   minmax(0,1fr) 84px 84px 84px 78px 78px 74px 104px 30px
 * Narrower breakpoints drop the middle metrics rather than crushing them.
 */
const GRID =
    "grid items-center gap-3.5 grid-cols-[minmax(0,1fr)_72px_92px_30px] " +
    "xl:grid-cols-[minmax(0,1fr)_84px_84px_84px_78px_78px_74px_104px_30px]"

const WIDE_CELL = "hidden xl:block text-right mono text-[14px] text-muted-foreground"

/** How many rows before "Load more". */
const PAGE_SIZE = 10

function titleOf(post: AnalyzedPost): string {
    const caption = (post.caption ?? "").trim()
    if (!caption) return "(no caption)"
    return (caption.split("\n").find((l) => l.trim().length > 0) ?? caption).trim().slice(0, 90)
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

function erText(post: AnalyzedPost): string {
    const er = engagementRate(post)
    return er === undefined ? "—" : `${(er * 100).toFixed(1)}%`
}

// ------------------------------------------------------------

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-[18px] py-4">
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span>{label}</span>
            </div>
            <span className="mono text-[28px] font-semibold tracking-[-0.02em] text-foreground">{value}</span>
            <span className="text-[12px] text-muted-foreground">{note ?? " "}</span>
        </div>
    )
}

function Bullets({ items, tone }: { items: string[]; tone: "up" | "down" }) {
    return (
        <div className="flex flex-col gap-2 text-[13.5px] leading-[1.5] text-muted-foreground">
            {items.map((item, i) => (
                <div key={i} className="flex gap-2.5">
                    <span
                        className={cn(
                            "mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full",
                            tone === "up" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                    />
                    <span>{item}</span>
                </div>
            ))}
        </div>
    )
}

/**
 * Account-level read as a table. Rows pair by index — the two lists are
 * independent, so a short one leaves blanks rather than stretching a cell.
 */
function SummaryTable({ working, improve }: { working: string[]; improve: string[] }) {
    const rows = Math.max(working.length, improve.length)
    if (rows === 0) return null

    const cell = "align-top py-2.5 text-[13.5px] leading-[1.5] text-muted-foreground"

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
                <thead>
                    <tr className="border-b border-border">
                        <th className={cn(EYEBROW, "w-1/2 border-r border-border py-2 pr-5 text-emerald-500")}>
                            What&apos;s working
                        </th>
                        <th className={cn(EYEBROW, "w-1/2 py-2 pl-5 text-amber-500")}>What to improve</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }, (_, i) => (
                        <tr key={i} className="border-b border-border last:border-b-0">
                            <td className={cn(cell, "border-r border-border pr-5")}>
                                {working[i] && (
                                    <span className="flex gap-2.5">
                                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-emerald-500" />
                                        <span>{working[i]}</span>
                                    </span>
                                )}
                            </td>
                            <td className={cn(cell, "pl-5")}>
                                {improve[i] && (
                                    <span className="flex gap-2.5">
                                        <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-amber-500" />
                                        <span>{improve[i]}</span>
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function SummaryPanel({ summary, postCount }: { summary: AnalysisSummary; postCount: number }) {
    return (
        <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-card px-[22px] py-5">
            <div className="flex items-center gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                    <Sparkles className="h-3 w-3" strokeWidth={2.2} />
                </div>
                <span className={cn(EYEBROW, "text-muted-foreground")}>
                    AI summary · all {postCount} posts
                </span>
            </div>

            {summary.headline && (
                <p className="max-w-[62ch] text-pretty text-[18px] leading-[1.5] tracking-[-0.01em] text-foreground">
                    {summary.headline}
                </p>
            )}

            <SummaryTable working={summary.what_is_working} improve={summary.what_to_improve} />

            {summary.next_post && (
                <div className="flex flex-col gap-2 rounded-[11px] border border-border bg-muted/40 px-4 py-3.5 sm:flex-row sm:gap-3.5">
                    <span className={cn(EYEBROW, "shrink-0 whitespace-nowrap tracking-[0.09em] text-muted-foreground sm:pt-0.5")}>
                        Next post
                    </span>
                    <p className="text-[13.5px] leading-[1.55] text-foreground">{summary.next_post}</p>
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
        <div className="flex flex-col gap-[18px] rounded-[14px] border border-border bg-card px-[22px] py-5">
            <span className={cn(EYEBROW, "text-muted-foreground")}>Content score</span>

            <div className="flex items-baseline gap-2.5">
                <span className="mono text-[46px] font-semibold leading-none tracking-[-0.03em] text-foreground">
                    {score}
                </span>
                <span className="text-[15px] text-muted-foreground">/ 100 avg</span>
            </div>

            <div className="h-[7px] overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${score}%` }} />
            </div>

            {scored > 0 && (
                <div className="mono flex gap-1.5 text-[10.5px]">
                    {bands.top > 0 && (
                        <span className="rounded-[7px] bg-emerald-500/10 px-2 py-1.5 text-center text-emerald-500" style={{ flex: bands.top }}>
                            {bands.top} top
                        </span>
                    )}
                    {bands.average > 0 && (
                        <span className="rounded-[7px] bg-muted px-2 py-1.5 text-center text-muted-foreground" style={{ flex: bands.average }}>
                            {bands.average} average
                        </span>
                    )}
                    {bands.under > 0 && (
                        <span className="rounded-[7px] bg-amber-500/10 px-2 py-1.5 text-center text-amber-500" style={{ flex: bands.under }}>
                            {bands.under} under
                        </span>
                    )}
                </div>
            )}

            {leaderboard.length > 0 && (
                <>
                    <div className="h-px bg-border" />
                    <span className={cn(EYEBROW, "text-muted-foreground")}>Format leaderboard</span>
                    <div className="flex flex-col gap-3">
                        {leaderboard.map((row) => (
                            <div key={row.format} className="flex flex-col gap-1.5">
                                <div className="flex justify-between text-[13px]">
                                    <span className="text-foreground">
                                        {row.format[0] + row.format.slice(1).toLowerCase()}s · {row.count}{" "}
                                        {row.count === 1 ? "post" : "posts"}
                                    </span>
                                    <span className="mono text-muted-foreground">avg {row.avgScore}</span>
                                </div>
                                <div className="h-[5px] rounded-full bg-muted">
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

type SortKey = "views" | "likes" | "reach" | "er" | "score"

const SORTS: { key: SortKey; label: string }[] = [
    { key: "views", label: "Views ↓" },
    { key: "likes", label: "Likes" },
    { key: "reach", label: "Reach" },
    { key: "er", label: "ER" },
    { key: "score", label: "Score" },
]

const FORMATS: (PostFormat | "ALL")[] = ["ALL", "REEL", "CAROUSEL", "STATIC", "STORY"]

type PerformanceFilter = "all" | Band
type RangeFilter = "all" | "7" | "30" | "90"

const RANGE_LABEL: Record<RangeFilter, string> = {
    all: "All time",
    "7": "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 90 days",
}

/** The design's chip-styled dropdowns. A native select keeps them accessible. */
function SelectChip({ prefix, value, options, onChange }: {
    prefix?: string
    value: string
    options: { value: string; label: string }[]
    onChange: (value: string) => void
}) {
    return (
        <div className={cn(CHIP, "relative flex items-center gap-1.5 px-3 py-2 text-[13px] text-muted-foreground")}>
            {prefix && <span>{prefix}</span>}
            <span className="font-semibold text-foreground">
                {options.find((o) => o.value === value)?.label}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0" />
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={prefix ?? "Filter"}
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
        </div>
    )
}

function PostRow({ post, averages, open, onToggle }: {
    post: AnalyzedPost
    averages: Record<string, number>
    open: boolean
    onToggle: () => void
}) {
    const verdict = post.analysis
    const tone = verdict ? band(verdict.score) : "average"
    const thumb = post.thumbnail_url || post.media_url
    const comparisons = useMemo(() => compareToAverage(post, averages), [post, averages])

    return (
        <div className="border-b border-border last:border-b-0">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={cn(GRID, "w-full px-5 py-3 text-left transition-colors hover:bg-muted/40")}
            >
                <div className="flex min-w-0 items-center gap-3.5">
                    <div className="relative h-[60px] w-[46px] shrink-0 overflow-hidden rounded-[7px] border border-border bg-muted">
                        {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center">
                                <Film className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                        )}
                        <span className="mono absolute bottom-[3px] left-[3px] rounded-[3px] bg-black/70 px-1 py-px text-[7.5px] tracking-[0.06em] text-white">
                            {formatOf(post)}
                        </span>
                    </div>

                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[14px] font-medium tracking-[-0.005em] text-foreground">
                            {titleOf(post)}
                        </span>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span className="truncate">{dateOf(post)}</span>
                            {verdict && (
                                <>
                                    <span className="opacity-40">·</span>
                                    <span className={cn("shrink-0 font-semibold", BAND_TEXT[tone])}>
                                        {BAND_LABEL[tone]}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <span className="mono text-right text-[14px] font-medium text-foreground">{metric(post.views)}</span>
                <span className={WIDE_CELL}>{metric(post.reach)}</span>
                <span className={WIDE_CELL}>{metric(post.like_count)}</span>
                <span className={WIDE_CELL}>{metric(post.saved)}</span>
                <span className={WIDE_CELL}>{metric(post.comments_count)}</span>
                <span className={WIDE_CELL}>{erText(post)}</span>

                <div className="flex items-center justify-end gap-2.5">
                    {verdict ? (
                        <>
                            <div className="hidden h-[5px] w-8 overflow-hidden rounded-full bg-muted sm:block">
                                <div className={cn("h-full rounded-full", BAND_BAR[tone])} style={{ width: `${verdict.score}%` }} />
                            </div>
                            <span className={cn("mono text-[14px] font-semibold", BAND_TEXT[tone])}>{verdict.score}</span>
                        </>
                    ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                </div>

                <span className="flex justify-end text-muted-foreground">
                    {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
            </button>

            {open && verdict && (
                <div className="bg-muted/20 px-5 pb-5 xl:pl-20">
                    <div className="grid gap-[22px] rounded-xl border border-border bg-card px-5 py-[18px] xl:grid-cols-[1.35fr_1fr]">
                        <div className="flex flex-col gap-[15px]">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-foreground text-background">
                                    <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
                                </div>
                                <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>Post analysis</span>
                                {verdict.verdict && (
                                    <span className="text-[12px] text-muted-foreground">· {verdict.verdict}</span>
                                )}
                            </div>

                            <div className="grid gap-5 sm:grid-cols-2">
                                {verdict.working.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-[9.5px] text-emerald-500")}>Working</span>
                                        <Bullets items={verdict.working} tone="up" />
                                    </div>
                                )}
                                {verdict.improve.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        <span className={cn(EYEBROW, "text-[9.5px] text-amber-500")}>To improve</span>
                                        <Bullets items={verdict.improve} tone="down" />
                                    </div>
                                )}
                            </div>

                            {verdict.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {verdict.tags.map((tag, i) => (
                                        <span
                                            key={i}
                                            className="mono rounded-full border border-border bg-muted px-[9px] py-[5px] text-[10px] tracking-[0.04em] text-muted-foreground"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {verdict.next && (
                                <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-muted/50 px-[15px] py-3.5 sm:flex-row sm:gap-3.5">
                                    <span className={cn(EYEBROW, "shrink-0 whitespace-nowrap text-[9.5px] tracking-[0.09em] text-muted-foreground sm:pt-0.5")}>
                                        Do next
                                    </span>
                                    <p className="text-[13px] leading-[1.55] text-foreground">{verdict.next}</p>
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

                        <div className="flex flex-col gap-3.5 xl:border-l xl:border-border xl:pl-[22px]">
                            {comparisons.length > 0 && (
                                <>
                                    <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>vs. your average</span>
                                    <div className="flex flex-col gap-[11px]">
                                        {comparisons.map((row) => (
                                            <div key={row.label} className="flex flex-col gap-[5px]">
                                                <div className="flex justify-between text-[12.5px]">
                                                    <span className="text-muted-foreground">{row.label}</span>
                                                    <span className={cn("mono font-semibold", TONE_TEXT[row.tone])}>{row.delta}</span>
                                                </div>
                                                <div className="h-1 rounded-full bg-muted">
                                                    <div className={cn("h-full rounded-full", TONE_BAR[row.tone])} style={{ width: `${row.pct}%` }} />
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
                                        <span className={cn(EYEBROW, "text-[9.5px] text-muted-foreground")}>Predicted lift if fixed</span>
                                        <span className="mono text-[24px] font-semibold text-emerald-500">{verdict.lift}</span>
                                        {verdict.lift_note && (
                                            <span className="text-[12px] leading-[1.45] text-muted-foreground">{verdict.lift_note}</span>
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

const PRESET_KEY = "deep-analysis-preset"

export function DeepAnalysis({ userId }: { userId: string }) {
    const [saved, setSaved] = useState<SavedAnalysis | null>(null)
    const [loading, setLoading] = useState(true)
    const [running, setRunning] = useState(false)

    const [search, setSearch] = useState("")
    const [format, setFormat] = useState<PostFormat | "ALL">("ALL")
    const [performance, setPerformance] = useState<PerformanceFilter>("all")
    const [range, setRange] = useState<RangeFilter>("all")
    const [sort, setSort] = useState<SortKey>("views")
    const [open, setOpen] = useState<string | null>(null)
    const [shown, setShown] = useState(PAGE_SIZE)

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

    // Restore the saved filter preset, if there is one.
    useEffect(() => {
        try {
            const raw = localStorage.getItem(PRESET_KEY)
            if (!raw) return
            const preset = JSON.parse(raw)
            if (preset.format) setFormat(preset.format)
            if (preset.performance) setPerformance(preset.performance)
            if (preset.range) setRange(preset.range)
            if (preset.sort) setSort(preset.sort)
        } catch { /* a corrupt preset should never block the page */ }
    }, [])

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
        const cutoff = range === "all" ? null : Date.now() - Number(range) * 86_400_000

        const filtered = posts.filter((post) => {
            if (format !== "ALL" && formatOf(post) !== format) return false
            if (performance !== "all" && (!post.analysis || band(post.analysis.score) !== performance)) return false
            if (cutoff && (!post.timestamp || new Date(post.timestamp).getTime() < cutoff)) return false
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
    }, [posts, search, format, performance, range, sort])

    const exportCsv = useCallback(() => {
        const header = ["Date", "Format", "Caption", "Views", "Reach", "Likes", "Saves", "Comments", "ER", "AI score", "Verdict", "Do next", "Permalink"]
        const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`

        const rows = visible.map((p) => [
            p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : "",
            formatOf(p),
            (p.caption ?? "").replace(/\s+/g, " ").trim(),
            p.views ?? "", p.reach ?? "", p.like_count ?? "", p.saved ?? "", p.comments_count ?? "",
            erText(p),
            p.analysis?.score ?? "",
            p.analysis?.verdict ?? "",
            p.analysis?.next ?? "",
            p.permalink ?? "",
        ].map(escape).join(","))

        const blob = new Blob([[header.map(escape).join(","), ...rows].join("\n")], {
            type: "text/csv;charset=utf-8",
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `deep-analysis-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(`Exported ${visible.length} posts`)
    }, [visible])

    const savePreset = useCallback(() => {
        localStorage.setItem(PRESET_KEY, JSON.stringify({ format, performance, range, sort }))
        toast.success("Preset saved — these filters load by default now")
    }, [format, performance, range, sort])

    const header = (
        <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
                <h1 className="text-[26px] font-bold tracking-[-0.02em] text-foreground">Deep Analysis</h1>
                <p className="text-[14px] text-muted-foreground">
                    What worked, what didn&apos;t, and what to post next.
                </p>
            </div>
            {saved && (
                <div className="flex items-center gap-2.5">
                    <button
                        onClick={exportCsv}
                        className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export CSV
                    </button>
                    <button
                        onClick={run}
                        disabled={running}
                        className="inline-flex items-center gap-2 rounded-[9px] bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {running ? "Analysing…" : "Re-run AI analysis"}
                    </button>
                </div>
            )}
        </div>
    )

    if (loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!saved) {
        return (
            <div className="type-design flex flex-col gap-[18px]">
                {header}
                <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border px-6 py-20 text-center">
                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                        <Sparkles className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <h2 className="text-[15px] font-medium text-foreground">Analyse your last 25 posts</h2>
                    <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                        Scores every post against the rest of your account and tells you what worked,
                        what didn&apos;t, and what to post next.
                    </p>
                    <button
                        onClick={run}
                        disabled={running}
                        className="mt-6 inline-flex items-center gap-2 rounded-[9px] bg-foreground px-4 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
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
            </div>
        )
    }

    return (
        <div className="type-design flex flex-col gap-[18px]">
            {header}

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

            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Views" value={metric(totals.views)} note={`across ${totals.measured} measured posts`} />
                <StatCard
                    label="Reach"
                    value={metric(totals.reach)}
                    note={account?.profile.followers_count ? `${compact(account.profile.followers_count)} followers` : undefined}
                />
                <StatCard
                    label="Engagement rate"
                    value={totals.engagementRate === undefined ? "—" : `${(totals.engagementRate * 100).toFixed(1)}%`}
                    note="interactions over reach"
                />
                <StatCard
                    label="Followers gained"
                    value={totals.netFollows === undefined ? "—" : `${totals.netFollows > 0 ? "+" : ""}${compact(totals.netFollows)}`}
                    note={account?.insights?.window_days ? `last ${account.insights.window_days} days` : "not reported"}
                />
            </div>

            <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_360px]">
                {saved.summary && <SummaryPanel summary={saved.summary} postCount={saved.posts_analyzed} />}
                <ScorePanel posts={posts} />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className={cn(CHIP, "flex min-w-[220px] flex-1 items-center gap-2.5 px-3 py-2")}>
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search caption or #hashtag"
                        className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </div>

                <div className={cn(CHIP, "flex gap-[3px] p-[3px]")}>
                    {FORMATS.map((option) => (
                        <button
                            key={option}
                            onClick={() => setFormat(option)}
                            className={cn(
                                "rounded-[7px] px-3 py-1.5 text-[13px] transition-colors",
                                format === option
                                    ? "bg-muted font-semibold text-foreground"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {option === "ALL" ? "All" : option[0] + option.slice(1).toLowerCase() + "s"}
                        </button>
                    ))}
                </div>

                <SelectChip
                    prefix="Performance:"
                    value={performance}
                    onChange={(v) => setPerformance(v as PerformanceFilter)}
                    options={[
                        { value: "all", label: "All" },
                        { value: "top", label: "Top" },
                        { value: "average", label: "Average" },
                        { value: "under", label: "Under" },
                    ]}
                />

                <SelectChip
                    value={range}
                    onChange={(v) => setRange(v as RangeFilter)}
                    options={(Object.keys(RANGE_LABEL) as RangeFilter[]).map((k) => ({
                        value: k, label: RANGE_LABEL[k],
                    }))}
                />

                <button
                    onClick={savePreset}
                    className="flex items-center gap-1.5 rounded-[9px] border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                    <Star className="h-3 w-3" />
                    Save preset
                </button>

                <div className="flex flex-1 items-center justify-end gap-2">
                    <span className="text-[12px] text-muted-foreground">Sort</span>
                    <div className={cn(CHIP, "flex gap-[3px] p-[3px]")}>
                        {SORTS.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => setSort(option.key)}
                                className={cn(
                                    "rounded-[7px] px-[11px] py-1.5 text-[13px] transition-colors",
                                    sort === option.key
                                        ? "bg-foreground font-semibold text-background"
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
            <div className="overflow-hidden rounded-[14px] border border-border bg-card">
                <div
                    className={cn(
                        GRID,
                        EYEBROW,
                        "border-b border-border bg-muted/40 px-5 py-[11px] text-[9.5px] tracking-[0.09em] text-muted-foreground",
                    )}
                >
                    <span>Post</span>
                    <span className="text-right">Views</span>
                    <span className="hidden text-right xl:block">Reach</span>
                    <span className="hidden text-right xl:block">Likes</span>
                    <span className="hidden text-right xl:block">Saves</span>
                    <span className="hidden text-right xl:block">Comm.</span>
                    <span className="hidden text-right xl:block">ER</span>
                    <span className="text-right">AI score</span>
                    <span />
                </div>

                {visible.length === 0 ? (
                    <p className="px-5 py-12 text-center text-[13px] text-muted-foreground">
                        No posts match those filters.
                    </p>
                ) : (
                    visible.slice(0, shown).map((post, i) => {
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
                    <div className="flex items-center justify-between px-5 py-[13px] text-[12.5px] text-muted-foreground">
                        <span>Showing {Math.min(shown, visible.length)} of {visible.length} posts</span>
                        {shown < visible.length && (
                            <button
                                onClick={() => setShown((n) => n + PAGE_SIZE)}
                                className="text-foreground transition-opacity hover:opacity-70"
                            >
                                Load more ↓
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
