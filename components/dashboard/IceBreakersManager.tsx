"use client"

import { useState, useEffect } from "react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Plus, Trash2, Save, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { IceBreaker } from "@/types/db"

export function IceBreakersManager() {
    const { userId, isLoading } = useInstagramSession()
    const [breakers, setBreakers] = useState<Partial<IceBreaker>[]>([])
    const [saving, setSaving] = useState(false)
    const [fetching, setFetching] = useState(true)

    useEffect(() => {
        if (!userId) return
        fetch(`/api/ice-breakers?userId=${userId}`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setBreakers(data)
                setFetching(false)
            })
            .catch(err => {
                console.error(err)
                setFetching(false)
            })
    }, [userId])

    const handleAdd = () => {
        if (breakers.length >= 4) {
            toast.error("Maximum 4 Ice Breakers allowed by Instagram")
            return
        }
        setBreakers([...breakers, { question: "", response: "" }])
    }

    const handleChange = (index: number, field: "question" | "response", value: string) => {
        const newBreakers = [...breakers]
        newBreakers[index] = { ...newBreakers[index], [field]: value }
        setBreakers(newBreakers)
    }

    const handleRemove = (index: number) => {
        setBreakers(breakers.filter((_, i) => i !== index))
    }

    const handleSave = async () => {
        if (!userId) return

        // Validation
        if (breakers.some(b => !b.question?.trim() || !b.response?.trim())) {
            toast.error("Please fill in all fields")
            return
        }

        setSaving(true)
        try {
            const res = await fetch("/api/ice-breakers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, iceBreakers: breakers })
            })
            const data = await res.json()
            if (data.success) {
                toast.success("Ice Breakers saved & synced usually!")
            } else {
                toast.error("Failed to save")
            }
        } catch (e) {
            toast.error("Error saving")
        } finally {
            setSaving(false)
        }
    }

    if (isLoading || fetching && !breakers.length) {
        return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
    }

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">Ice breakers</h2>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                        Questions people see when they start a chat with you.
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving} className="shrink-0">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Save & sync
                </Button>
            </div>

            <div className="space-y-4">
                {breakers.map((item, idx) => (
                    <div key={idx} className="relative space-y-3 rounded-xl border border-border bg-card p-4">
                        <div className="flex justify-between items-start gap-4">
                            <div className="flex-1 space-y-3">
                                <div>
                                    <label className="text-[13px] font-medium text-foreground">Question</label>
                                    <Input
                                        value={item.question}
                                        onChange={e => handleChange(idx, "question", e.target.value)}
                                        placeholder="e.g., What are your prices?"
                                        className="mt-1.5"
                                        maxLength={80}
                                    />
                                </div>
                                <div>
                                    <label className="text-[13px] font-medium text-foreground">Auto-response</label>
                                    <Textarea
                                        value={item.response}
                                        onChange={e => handleChange(idx, "response", e.target.value)}
                                        placeholder="The reply users will receive..."
                                        className="mt-1.5"
                                        rows={2}
                                    />
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemove(idx)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}

                {breakers.length === 0 && (
                    <div className="text-center py-10 border border-dashed border-border rounded-xl text-muted-foreground">
                        No ice breakers yet. Add one to get started!
                    </div>
                )}

                {breakers.length < 4 && (
                    <Button variant="outline" onClick={handleAdd} className="w-full border-dashed text-muted-foreground hover:text-foreground">
                        <Plus className="w-4 h-4 mr-2" /> Add question
                    </Button>
                )}
            </div>

            <div className="flex gap-3 rounded-xl border border-border bg-muted/40 p-4 text-[13px] leading-relaxed text-muted-foreground">
                <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                <p>
                    Changes made here are automatically synced to your Instagram Profile. It may take a few minutes for them to appear for all users.
                </p>
            </div>
        </div>
    )
}
