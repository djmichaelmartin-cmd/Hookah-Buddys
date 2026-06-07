---
name: UI mutation error handling
description: Member-facing mutations must surface server errors (esp. 402 credits) via toast, or features look "broken"
---

# Surface mutation errors in the UI

Any user-triggered mutation (send message, unlock content, request video chat, etc.) must have an `onError` handler that shows a toast. Without one, a failed request silently does nothing and the user reports the feature as "broken."

**Why:** The Messages page send-message mutation had no `onError`. Members start with 0 credits, so sending hit the server's `402 { error: "Not enough credits…" }` and silently failed — user reported "messages don't work." The backend was correct; only the UI feedback was missing.

**How to apply:**
- Read the server message from the thrown error: errors are `ApiError` (exported from `@workspace/api-client-react`) with `.status` and `.data` (shape `{ error: string }`). Narrow with `err instanceof ApiError` then read `err.data.error`.
- For `402` (insufficient credits) add a "Buy credits" action linking to `/pricing`.
- Toast system: `useToast` from `@/hooks/use-toast`; use `variant: "destructive"` for failures.
- Conversation bubble alignment must key off the *current user's* role (`useGetCurrentUser().user.role`), not a hardcoded `'member'` — otherwise a Doll sees her own replies on the wrong side.
