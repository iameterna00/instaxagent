const GRAPH = "https://graph.instagram.com/v24.0"

/**
 * Dry run: log what would be sent instead of sending it.
 *
 * Local development reached through a tunnel receives real webhook deliveries,
 * so without this a laptop would DM real followers — and twice over, because
 * production is processing the same events. Every outbound write in this file
 * goes through `post()`, so this one switch covers DMs, comment replies,
 * reactions and typing indicators.
 *
 * `npm run dev:tunnel` turns this on by default; set INSTAGRAM_DRY_RUN=false to
 * deliberately send for real from a local server.
 */
const DRY_RUN = process.env.INSTAGRAM_DRY_RUN === "true"

export function isDryRun(): boolean {
  return DRY_RUN
}

export interface IGButton {
  type: "web_url" | "postback"
  title: string
  url?: string
  payload?: string
}

export interface IGCard {
  title: string
  subtitle?: string
  image_url?: string
  buttons: IGButton[]
}

export interface QuickReply {
  title: string
  payload: string
}

export interface SendResult {
  ok: boolean
  id?: string
  error?: any
}

async function post(path: string, token: string, body: any): Promise<SendResult> {
  if (DRY_RUN) {
    // Reported as success so the calling code follows its normal path — the
    // point is to exercise the logic, just without touching a real account.
    console.log(`[ig-api] DRY RUN — not sent: ${path} ${JSON.stringify(body).slice(0, 400)}`)
    return { ok: true, id: `dryrun_${Date.now()}` }
  }

  try {
    const res = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (json.error) {
      console.error(`[ig-api] ${path} failed:`, JSON.stringify(json.error))
      return { ok: false, error: json.error }
    }
    return { ok: true, id: json.id || json.message_id }
  } catch (e) {
    console.error(`[ig-api] ${path} network error:`, e)
    return { ok: false, error: e }
  }
}

export function buildCardAttachment(card: IGCard) {
  const buttons = (card.buttons || [])
    .filter((b) => b.title)
    .map((b) => ({
      type: b.type,
      title: b.title,
      url: b.type === "web_url" ? b.url : undefined,
      payload: b.type === "postback" ? b.payload : undefined,
    }))
  const element: any = { title: card.title, buttons }
  if (card.subtitle) element.subtitle = card.subtitle
  if (card.image_url?.startsWith("http")) element.image_url = card.image_url
  return {
    attachment: {
      type: "template",
      payload: { template_type: "generic", elements: [element] },
    },
  }
}

export async function sendTextDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  text: string,
  quickReplies?: QuickReply[],
): Promise<SendResult> {
  const message: any = { text }
  if (quickReplies?.length) {
    message.quick_replies = quickReplies.slice(0, 13).map((q) => ({
      content_type: "text",
      title: q.title.slice(0, 20),
      payload: q.payload,
    }))
  }
  return post("me/messages", token, { recipient, message })
}

export async function sendCardDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  card: IGCard,
): Promise<SendResult> {
  return post("me/messages", token, { recipient, message: buildCardAttachment(card) })
}

export async function sendMediaDM(
  token: string,
  recipient: { id?: string; comment_id?: string },
  mediaType: "image" | "video" | "audio",
  url: string,
): Promise<SendResult> {
  return post("me/messages", token, {
    recipient,
    message: { attachment: { type: mediaType, payload: { url } } },
  })
}

export async function sendSenderAction(
  token: string,
  recipientId: string,
  action: "typing_on" | "typing_off" | "mark_seen",
): Promise<SendResult> {
  return post("me/messages", token, { recipient: { id: recipientId }, sender_action: action })
}

export async function sendMessageReaction(
  token: string,
  recipientId: string,
  messageId: string,
  reaction = "love",
): Promise<SendResult> {
  return post("me/messages", token, {
    recipient: { id: recipientId },
    sender_action: "react",
    payload: { message_id: messageId, reaction },
  })
}

export async function replyToComment(token: string, commentId: string, message: string): Promise<SendResult> {
  return post(`${commentId}/replies`, token, { message })
}

export async function fetchProfile(token: string, igUserId: string): Promise<{ username?: string; name?: string } | null> {
  try {
    const res = await fetch(`${GRAPH}/${igUserId}?fields=username,name&access_token=${encodeURIComponent(token)}`)
    const json = await res.json()
    if (json.error) return null
    return json
  } catch {
    return null
  }
}

export interface MessagingProfile {
  username?: string
  name?: string
  /** true when this person follows the business account */
  is_user_follow_business?: boolean
  /** true when the business account follows this person */
  is_business_follow_user?: boolean
}

/**
 * Profile lookup for someone who has messaged us, including the follow-relationship
 * flags used by the AI agent's audience rules. Those fields need
 * `instagram_business_manage_messages` and are not returned for every account, so
 * we fall back to the plain profile rather than failing the whole lookup.
 */
export async function fetchMessagingProfile(token: string, igUserId: string): Promise<MessagingProfile | null> {
  const withFollowFlags = "username,name,is_user_follow_business,is_business_follow_user"
  try {
    const res = await fetch(
      `${GRAPH}/${igUserId}?fields=${withFollowFlags}&access_token=${encodeURIComponent(token)}`,
    )
    const json = await res.json()
    if (!json.error) return json
    console.warn(`[ig-api] follow flags unavailable for ${igUserId}:`, JSON.stringify(json.error))
  } catch (e) {
    console.warn(`[ig-api] follow flag lookup failed for ${igUserId}:`, e)
  }
  return fetchProfile(token, igUserId)
}

export async function verifyIdOwnership(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${id}?fields=id&access_token=${encodeURIComponent(token)}`)
    return res.ok
  } catch {
    return false
  }
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, Math.min(ms, 8000)))
}
