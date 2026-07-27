"use client"

import { useCallback, useEffect, useState } from "react"
import {
    Loader2, Wand2, Copy, Check, Trash2, ChevronDown, Target, History, AlertTriangle, Eye, Film,
} from "lucide-react"
import type { ContentIdea, ContentAnalysis, OwnPost } from "@/lib/ai/content"

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
        <div className="rounded-2xl border border-white/10 bg-[#0b0b0a] p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className={label}>
                    {hasViews ? "Your posts, best performing first" : "Posts it read"}
                </span>
                <span className="text-[10px] text-neutral-600">{posts.length} analysed</span>
            </div>

            {!hasViews && (
                <p className="text-[11px] text-neutral-500 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-neutral-600" />
                    No view or reach numbers came back — reconnect your Instagram account from the login screen to grant
                    insights access, then regenerate for performance-aware analysis.
                </p>
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
                            className="group relative aspect-square rounded-lg overflow-hidden border border-white/10 bg-white/[0.03] hover:border-[#ffe14d]/40 transition-colors"
                        >
                            {thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <Film className="w-4 h-4 text-neutral-700" />
                                </div>
                            )}

                            {post.media_product_type === "REELS" && (
                                <Film className="absolute top-1.5 right-1.5 w-3 h-3 text-white drop-shadow" />
                            )}

                            {metric !== undefined && (
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pt-4 pb-1.5">
                                    <span className="flex items-center gap-1 text-[10px] font-semibold text-white">
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
                    className="text-[11px] font-mono-ui uppercase tracking-widest text-neutral-500 hover:text-[#ffe14d] transition-colors"
                >
                    {expanded ? "Show less" : `Show all ${ranked.length}`}
                </button>
            )}
        </div>
    )
}

const FORMATS = ["reel", "carousel", "story", "post"]

const label = "font-mono-ui text-[10px] uppercase tracking-[0.2em] text-neutral-500"
const field =
    "w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#ffe14d]/50 transition-colors"

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            onClick={() => {
                navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
            }}
            className={`text-neutral-500 hover:text-[#ffe14d] transition-colors ${className}`}
            title="Copy"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-[#ffe14d]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    )
}

function IdeaCard({ idea, index }: { idea: ContentIdea; index: number }) {
    const [open, setOpen] = useState(index === 0)

    const fullText = [
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
        <div className="rounded-2xl border border-white/10 bg-[#0b0b0a] overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-start gap-3 p-5 text-left hover:bg-white/[0.02] transition-colors"
            >
                <span className="font-mono-ui text-[10px] text-neutral-600 mt-1 shrink-0">
                    {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-ui text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#ffe14d]/10 text-[#ffe14d] border border-[#ffe14d]/25">
                            {idea.format}
                        </span>
                        <span className="text-white font-medium text-sm">{idea.title}</span>
                    </div>
                    <p className="text-sm text-neutral-400 mt-2 italic">&ldquo;{idea.hook}&rdquo;</p>
                </div>
                <ChevronDown className={`w-4 h-4 text-neutral-600 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
                    {idea.why_it_works && (
                        <p className="text-xs text-neutral-500">
                            <span className="text-neutral-400">Why:</span> {idea.why_it_works}
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
                                    <li key={i} className="flex gap-3 text-sm text-neutral-300">
                                        <span className="font-mono-ui text-[10px] text-[#ffe14d] mt-1 shrink-0">{i + 1}</span>
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
                            <p className="text-sm text-neutral-300 whitespace-pre-wrap bg-black/40 rounded-xl p-4 border border-white/5">
                                {idea.caption}
                            </p>
                        </div>
                    )}

                    <div className="flex items-end justify-between gap-4 flex-wrap">
                        <div className="space-y-2">
                            {idea.cta && (
                                <p className="text-xs text-neutral-400">
                                    <span className={label}>CTA</span> <span className="ml-2">{idea.cta}</span>
                                </p>
                            )}
                            {idea.hashtags && idea.hashtags.length > 0 && (
                                <p className="text-xs text-neutral-600">{idea.hashtags.map(h => `#${h}`).join(" ")}</p>
                            )}
                        </div>
                        <button
                            onClick={() => navigator.clipboard.writeText(fullText)}
                            className="text-[11px] font-mono-ui uppercase tracking-widest text-neutral-500 hover:text-[#ffe14d] transition-colors flex items-center gap-1.5"
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

    const remove = async (id: string) => {
        await fetch(`/api/ai/content?id=${id}`, { method: "DELETE" })
        if (plan?.id === id) setPlan(null)
        loadHistory()
    }

    return (
        <div className="space-y-8">
            {/* Brief */}
            <div className="rounded-2xl border border-white/10 bg-[#0b0b0a] p-6 space-y-5">
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#ffe14d]/10 border border-[#ffe14d]/25 flex items-center justify-center shrink-0">
                        <Target className="w-4 h-4 text-[#ffe14d]" />
                    </div>
                    <div>
                        <h2 className="text-white font-semibold">What are you trying to achieve?</h2>
                        <p className="text-xs text-neutral-500 mt-1">
                            The studio reads your last 25 posts, then plans against this goal.
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
                                            ? "bg-[#ffe14d]/10 border-[#ffe14d]/40 text-[#ffe14d]"
                                            : "border-white/10 text-neutral-400 hover:text-white hover:border-white/30"
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
                                <option key={n} value={n} className="bg-[#0b0b0a]">{n} ideas</option>
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
                    <p className="text-[11px] text-neutral-600 mt-2 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        Competitor posts can&apos;t be fetched automatically on this login type — whatever you write here is
                        what it knows about them.
                    </p>
                </div>

                <div className="flex items-center justify-between gap-4 flex-wrap pt-1">
                    <div className="text-xs">
                        {error ? (
                            <span className="text-red-400">{error}</span>
                        ) : (
                            <span className="text-neutral-600">Uses the same API key as your AI agent.</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {history.length > 0 && (
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className="flex items-center gap-2 h-9 px-4 rounded-full border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 font-mono-ui text-[11px] font-bold uppercase tracking-widest transition-colors"
                            >
                                <History className="w-3.5 h-3.5" />
                                {history.length}
                            </button>
                        )}
                        <button
                            onClick={generate}
                            disabled={generating || !goal.trim()}
                            className="flex items-center gap-2 h-9 px-5 rounded-full bg-[#ffe14d] hover:brightness-95 text-black font-mono-ui text-[11px] font-bold uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
                        >
                            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                            {generating ? "Planning…" : "Generate"}
                        </button>
                    </div>
                </div>

                {generating && (
                    <p className="text-[11px] text-neutral-600">
                        Reading your posts and thinking it through — this usually takes 30–90 seconds.
                    </p>
                )}
            </div>

            {/* History */}
            {showHistory && (
                <div className="rounded-2xl border border-white/10 bg-[#0b0b0a] divide-y divide-white/5">
                    {history.map(item => (
                        <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors">
                            <button onClick={() => { setPlan(item); setShowHistory(false) }} className="flex-1 text-left min-w-0">
                                <p className="text-sm text-white truncate">{item.goal}</p>
                                <p className="text-[11px] text-neutral-600 mt-0.5">
                                    {new Date(item.created_at).toLocaleDateString()} · {item.ideas?.length ?? 0} ideas · {item.model}
                                </p>
                            </button>
                            <button onClick={() => remove(item.id)} className="text-neutral-600 hover:text-red-400 transition-colors shrink-0">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Result */}
            {plan && (
                <div className="space-y-6">
                    {plan.posts && plan.posts.length > 0 && <AnalyzedPosts posts={plan.posts} />}

                    {plan.analysis && (
                        <div className="rounded-2xl border border-[#ffe14d]/20 bg-[#ffe14d]/[0.04] p-6 space-y-4">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <span className={label}>Read on your account</span>
                                <span className="text-[10px] text-neutral-600">
                                    {plan.posts_analyzed} posts analysed · {plan.model}
                                </span>
                            </div>

                            {plan.analysis.niche && <p className="text-white text-sm font-medium">{plan.analysis.niche}</p>}
                            {plan.analysis.positioning && (
                                <p className="text-sm text-neutral-300 leading-relaxed">{plan.analysis.positioning}</p>
                            )}

                            <div className="grid sm:grid-cols-2 gap-5 pt-1">
                                {(plan.analysis.what_is_working?.length ?? 0) > 0 && (
                                    <div>
                                        <span className={label}>Working</span>
                                        <ul className="mt-2 space-y-1.5">
                                            {plan.analysis.what_is_working!.map((s, i) => (
                                                <li key={i} className="text-xs text-neutral-400 flex gap-2">
                                                    <span className="text-[#ffe14d]">+</span>{s}
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
                                                <li key={i} className="text-xs text-neutral-400 flex gap-2">
                                                    <span className="text-neutral-600">−</span>{s}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-3">
                        {plan.ideas.map((idea, i) => <IdeaCard key={i} idea={idea} index={i} />)}
                    </div>
                </div>
            )}
        </div>
    )
}
