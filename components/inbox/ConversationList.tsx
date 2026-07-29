"use client"

import { useEffect, useState } from "react"
import { Search, Loader2, UserCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Conversation } from "@/types/db"

interface ConversationListProps {
    userId: string
    selectedId: string | null
    onSelect: (id: string, username: string, recipientId: string) => void
}

export function ConversationList({ userId, selectedId, onSelect }: ConversationListProps) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!userId) return

        const fetchConversations = async () => {
            try {
                const res = await fetch(`/api/inbox/conversations?userId=${userId}`)
                const data = await res.json()
                if (Array.isArray(data)) {
                    setConversations(data)
                }
            } catch (error) {
                console.error("Failed to load conversations", error)
            } finally {
                setLoading(false)
            }
        }

        fetchConversations()
    }, [userId])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex h-full w-full flex-col md:w-[340px]">
            <div className="p-4 border-b border-border">
                <h2 className="mb-3 text-sm font-medium text-foreground">Inbox</h2>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                        placeholder="Search messages..."
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {conversations.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                        No conversations yet.
                    </div>
                ) : (
                    conversations.map((conv) => (
                        <div
                            key={conv.id}
                            onClick={() => onSelect(conv.id, conv.recipient_username, conv.recipient_id.toString())}
                            className={cn(
                                "flex cursor-pointer items-center gap-3 rounded-lg border border-transparent p-2.5 transition-colors",
                                selectedId === conv.id
                                    ? "border-border bg-muted"
                                    : "hover:bg-muted/50"
                            )}
                        >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                                <UserCircle className="h-5 w-5 text-muted-foreground" strokeWidth={1.6} />
                            </div>
                            <div className="flex-1 min-w-0 text-left">
                                <div className="flex items-center justify-between mb-0.5">
                                    <span className="truncate text-[13px] font-medium text-foreground">
                                        {conv.recipient_username}
                                    </span>
                                    <span className="numeric whitespace-nowrap text-[11px] text-muted-foreground">
                                        {new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                                <p className="truncate text-[13px] text-muted-foreground">
                                    Open to view conversation
                                </p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
