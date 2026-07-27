import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Create a Supabase server client
 * Use this in API routes and server actions
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Without these the client still constructs, then every query fails with an
  // opaque network error. Say what is actually wrong instead.
  if (!url || !serviceKey) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY"]
      .filter(Boolean)
      .join(", ")
    throw new Error(`Supabase is not configured — missing ${missing} in your .env`)
  }

  return createServerClient(url, serviceKey, {
    cookies: {
      getAll: async () => cookieStore.getAll(),
      setAll: async (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch (error) {
          console.error("[v0] Error setting cookies:", error)
        }
      },
    },
  })
}
