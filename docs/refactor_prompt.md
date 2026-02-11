# Refactoring Prompt

Copy everything below the line into a new conversation with Sonnet 4.5.

---

You are refactoring a Next.js 15 (App Router) + TypeScript codebase. Read `docs/architect_instructions.md` first — it contains the full architecture review. Your job is to execute Priorities 1 through 6 from that document exactly as specified.

## Ground Rules

- **Do not change any business logic, behavior, or API contracts.** This is a pure structural refactor.
- **Do not add comments, docstrings, or type annotations** to code you didn't write. Don't add JSDoc. Don't add `@param` tags.
- **Do not introduce new dependencies.** Only use what's already in `package.json`.
- **Do not create barrel exports** (`index.ts` files that re-export). Keep direct imports using the `@/` path alias.
- **Do not rename any existing exports.** All existing public function names, type names, and interface names must stay the same.
- **Preserve all existing imports across the codebase** — when you move code to a new file, update every file that imported from the old location.
- **Run `npx tsc --noEmit` after each priority** to verify zero type errors.
- **Run `npx vitest run` after each priority** to verify all 14 test files pass.
- **Commit after each priority** with a message like `refactor: priority N — <description>`.

## Priority 1: Decompose `components/rag-lab.tsx` (1,216 lines)

This is a god component with 32 useState hooks, 12 async functions, and 28 inline event handlers. Break it apart as follows.

### Step 1a: Create `components/api-client/index.ts`

Extract all `fetch()` calls from `rag-lab.tsx` into typed wrapper functions. The component currently makes fetch calls to these endpoints inline:

- `GET /api/me` → `fetchMe(): Promise<MeResponse>`
- `GET /api/threads?scope=...&cursor=...` → `fetchThreads(scope, cursor?): Promise<ThreadListResponse>`
- `POST /api/threads` → `createThread(visibility): Promise<{id, title, ...}>`
- `GET /api/threads/[id]` → `fetchThread(id): Promise<ThreadDetailResponse>`
- `POST /api/threads/[id]/messages` → `postMessage(threadId, body): Promise<ChatResponse>`
- `POST /api/threads/[id]/feedback` → `submitThreadFeedback(threadId, body): Promise<...>`
- `POST /api/messages/[id]/feedback` → `submitMessageFeedback(messageId, body): Promise<...>`
- `GET /api/me/keys` → `fetchApiKeys(): Promise<...>`
- `POST /api/me/keys` → `createApiKey(body): Promise<...>`
- `DELETE /api/me/keys/[id]` → `deleteApiKey(id): Promise<...>`
- `GET /api/stats` → `fetchStats(): Promise<...>`

Each function should: call `fetch()`, check `res.ok`, throw on failure, and return typed JSON. Move the response interfaces (`MeResponse`, `ThreadListResponse`, `ThreadListItem`, `ThreadDetailResponse`, `ChatResponse`, etc.) that are currently defined at the top of `rag-lab.tsx` into this file as named exports.

### Step 1b: Create custom hooks in `components/hooks/`

Extract state + effects into hooks. Each hook should use the api-client functions from step 1a.

**`components/hooks/use-user-profile.ts`**
- Owns: the `me` state (user + wallet), the `apiKeys` state, the `fetchMe()` call in the initial useEffect, and the `loadApiKeys()` / `handleCreateKey()` / `handleDeleteKey()` async functions.
- Returns: `{ me, apiKeys, refreshMe, loadApiKeys, createKey, deleteKey, isLoading }`

**`components/hooks/use-threads.ts`**
- Owns: `threads`, `threadsCursor`, `threadsScope`, `selectedThreadId`, `threadDetail` state. Also owns `loadThreads()`, `handleCreateThread()`, `loadThreadDetail()`, and the scope-switching logic.
- Returns: `{ threads, threadDetail, selectedThreadId, selectThread, createThread, loadMoreThreads, threadsScope, setThreadsScope, hasMore }`

**`components/hooks/use-model-catalog.ts`**
- Owns: `modelId`, `availableModels` state and the `useMemo` that computes model options.
- Returns: `{ modelId, setModelId, availableModels }`

### Step 1c: Create sub-components in `components/chat/`

**`components/chat/chat-page.tsx`**
- This is the new top-level component. It composes the hooks and sub-components. It replaces `RagLab` as the default export. It should be ~100-150 lines: just hook calls and layout JSX.
- Export it as `RagLab` (same name) so that `app/page.tsx` (`import { RagLab } from "@/components/rag-lab"`) does not need to change. To do this, create a re-export in the original `components/rag-lab.tsx` file: `export { RagLab } from "@/components/chat/chat-page"`. Then delete all the old code from `rag-lab.tsx` so it's just that one re-export line.

**`components/chat/thread-list.tsx`**
- Receives threads array, selected ID, onSelect callback, onCreateThread, scope, onScopeChange, onLoadMore, hasMore as props.
- Renders the sidebar list of threads with scope tabs (All/Mine) and "New thread" button.

**`components/chat/thread-detail.tsx`**
- Receives thread detail object, user ID, onSubmitThreadFeedback callback.
- Renders message history with citations, shows thread-level feedback form.

**`components/chat/chat-composer.tsx`**
- Receives modelId, availableModels, onModelChange, onSend, isSending, walletBalance, apiKeys, selectedApiKeyId, onApiKeyChange as props.
- Renders the message input textarea, model dropdown, API key selector, and send button.

**`components/chat/message-feedback.tsx`**
- Move the inline `MessageFeedbackBox` component that's currently defined at the bottom of `rag-lab.tsx` into this file as a proper export.

**`components/chat/thread-feedback.tsx`**
- Move the inline `ThreadFeedbackBox` component that's currently defined at the bottom of `rag-lab.tsx` into this file as a proper export.

### CSS Note for Priority 1

All existing CSS classes in `app/globals.css` stay where they are for now. The new sub-components use the same class names that `rag-lab.tsx` currently uses. Do not move or rename any CSS.

---

## Priority 2: Break up `lib/chat.ts` (471 lines)

The `runChatTurn()` function has 14 responsibilities. Split it into a pipeline of 3 stages.

### Step 2a: Create `lib/chat/prepare-request.ts`

Move these responsibilities out of `runChatTurn`:
1. Thread lookup + `assertThreadAccess()` (lines 35-59)
2. User message creation (lines 67-79)
3. Model catalog discovery + resolution (lines 81-109)
4. User API key validation + decryption (lines 111-194)
5. Parameter clamping (lines 196-198)

Export a function:
```typescript
export async function prepareChatRequest(input: RunChatTurnInput): Promise<PreparedChatRequest>
```

The `PreparedChatRequest` type should contain everything downstream needs: `thread`, `userMessage`, `modelId`, `modelSpec`, `parsedModel`, `apiKeyOverride`, `usingPersonalApiKey`, `selectedUserApiKeyId`, `selectedUserApiKeyProvider`, `userApiKeyUseAuditLogged`, `requestId`, `topK`, `temperature`, `maxOutputTokens`.

Also move the `clampNumber` and `auditReasonCodeFromError` helper functions here.

### Step 2b: Create `lib/chat/execute-turn.ts`

Move these responsibilities:
1. Message history retrieval (lines 200-219)
2. Retrieval integration — `getRetrievalMultiplierMap()` + `retrieveTopChunks()` + `buildRagSystemPrompt()` (lines 221-226)
3. Cost estimation + budget reservation (lines 228-252)
4. Provider call (lines 254-267)

Export a function:
```typescript
export async function executeChatTurn(prepared: PreparedChatRequest): Promise<ChatTurnExecution>
```

The `ChatTurnExecution` type should contain: `providerResult`, `measuredCost`, `actualCostCents`, `reservedBudgetCents`, `retrieval`, `systemPrompt`, `trimmedMessages`.

### Step 2c: Create `lib/chat/finalize-response.ts`

Move these responsibilities:
1. BYOK use audit logging (lines 272-282)
2. DB transaction: save assistant message + citations + update thread title (lines 284-344)
3. Wallet finalization (lines 346-384)
4. Response object construction (lines 386-420)

Export a function:
```typescript
export async function finalizeChatResponse(prepared: PreparedChatRequest, execution: ChatTurnExecution): Promise<ChatTurnResult>
```

### Step 2d: Create `lib/chat/index.ts`

This is the new `runChatTurn()` — it's just the pipeline:
```typescript
export async function runChatTurn(input: RunChatTurnInput) {
  const prepared = await prepareChatRequest(input);
  let execution: ChatTurnExecution;
  try {
    execution = await executeChatTurn(prepared);
  } catch (error) {
    // move the catch block from lines 421-449 here (audit log + release reservation)
    throw error;
  }
  return finalizeChatResponse(prepared, execution);
}
```

Re-export `RunChatTurnInput` from this file.

### Step 2e: Update imports

- `app/api/chat/route.ts` currently imports from `@/lib/chat`. Change it to `@/lib/chat/index` (or just `@/lib/chat` if the bundler resolves index files — test both).
- `tests-ts/chat.test.ts` currently mocks `@/lib/chat`. Update the mock path.
- Delete the old `lib/chat.ts` file.

---

## Priority 3: Extract DB connection logic from `lib/prisma.ts` (264 lines)

### Step 3a: Create `lib/db/connection-resolver.ts`

Move these functions and logic from `lib/prisma.ts`:
- `nonEmptyEnvValues()`
- `getDatabaseHost()`
- `getDatabaseHostname()`
- `hasDatabasePassword()`
- `getDatabaseIdentity()`
- `isNeonHostname()`
- `isPoolerHostname()`
- `buildAppUrlWithFallbackCredentials()`
- `selectDatabaseUrl()`
- `normalizeDatabaseUrl()`
- The `EnvCandidate` type

Export: `selectDatabaseUrl`, `normalizeDatabaseUrl`, `getDatabaseHost`, `getDatabaseHostname`, `isNeonHostname`, `EnvCandidate`, and `buildAppUrlWithFallbackCredentials`.

### Step 3b: Create `lib/db/neon-adapter.ts`

Move the Neon-specific adapter setup logic (current lines 243-256):
- WebSocket polyfill check
- `PrismaNeon` adapter construction
- `neonConfig` setup

Export a function:
```typescript
export function buildNeonAdapterOptions(databaseUrl: string): ConstructorParameters<typeof PrismaClient>[0] | null
```

Returns the adapter config if the URL is a Neon hostname, otherwise returns null.

### Step 3c: Rewrite `lib/db/prisma.ts` (rename from `lib/prisma.ts`)

This file should be ~30-40 lines:
1. Import `selectDatabaseUrl`, `normalizeDatabaseUrl`, `getDatabaseHost` from `./connection-resolver`
2. Import `buildNeonAdapterOptions` from `./neon-adapter`
3. Run the URL resolution (the current lines 196-232 condensed)
4. Call `assertUserApiKeyEncryptionConfigured()`
5. Build client options, conditionally applying Neon adapter
6. Export `prisma`

### Step 3d: Update all imports

Every file that imports `from "@/lib/prisma"` must change to `from "@/lib/db/prisma"`. Search the codebase for this import — it appears in approximately 15 files across `lib/` and `app/api/`. Update every single one.

Also check `tests-ts/` for any mocks of `@/lib/prisma` and update those paths too.

### Step 3e: Check `app/api/ops/db-status/route.ts`

This file (255 lines) imports helpers that may reference `lib/prisma.ts` internals. Make sure it still works after the move. If it imports any of the functions you moved to `connection-resolver.ts`, update the import path.

---

## Priority 4: Modularize CSS

### Step 4a: Create CSS Modules for the new chat components

For each component created in Priority 1, create a co-located `.module.css` file:

- `components/chat/thread-list.module.css`
- `components/chat/thread-detail.module.css`
- `components/chat/chat-composer.module.css`
- `components/chat/chat-page.module.css`
- `components/chat/message-feedback.module.css`
- `components/chat/thread-feedback.module.css`

### Step 4b: Migrate styles

For each component, find the CSS classes it uses in `app/globals.css`. **Copy** (don't move yet) the relevant rules into the component's `.module.css` file. In the component, import the module: `import styles from "./thread-list.module.css"` and replace `className="thread-list"` with `className={styles.threadList}` (camelCase the class names).

### Step 4c: Remove migrated rules from globals.css

After all components are converted, delete the rules from `app/globals.css` that are now in module files. Keep only: CSS variables (`:root`), base resets (`body`, `*`, `html`), and any truly global styles (scrollbar, selection, etc.).

**Important:** Do a visual check — run `npm run dev` and verify the app looks the same. CSS Module class names are auto-scoped, so specificity changes could cause regressions.

---

## Priority 5: Add Error Boundaries

### Step 5a: Create `app/error.tsx`

```typescript
"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="error-boundary">
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### Step 5b: Create `app/global-error.tsx`

```typescript
"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>{error.message}</p>
          <button onClick={reset}>Try again</button>
        </div>
      </body>
    </html>
  );
}
```

Add minimal styles for `.error-boundary` to `app/globals.css` (centered container, padding, readable text).

---

## Priority 6: Extract Route Business Logic

### Step 6a: Create `lib/thread-stats.ts`

Move the feedback aggregation logic from `app/api/threads/[id]/route.ts` into a function:
```typescript
export async function getThreadWithStats(threadId: string, userId: string): Promise<ThreadDetailResponse>
```

This function should contain the Prisma query with its complex `include` and the feedback aggregation computation that currently lives in the route handler. The route should call this function and return its result.

### Step 6b: Create `lib/user-stats.ts`

Move the token aggregation and type coercion logic from `app/api/me/route.ts` into a function:
```typescript
export async function getUserProfile(userId: string): Promise<UserProfileResponse>
```

The route should call this function and return its result.

### Step 6c: Deduplicate audit logging in key routes

The files `app/api/me/keys/route.ts` and `app/api/me/keys/[id]/route.ts` repeat the same audit logging pattern. Extract a shared helper:
```typescript
// lib/api-key-route-helpers.ts
export async function withApiKeyAudit(params: { userId, action, keyId, provider, requestId }, fn: () => Promise<Response>): Promise<Response>
```

This wrapper handles the try/catch and audit event logging so the route handlers can be shorter.

---

## Verification Checklist

After all 6 priorities are done:

1. `npx tsc --noEmit` — zero errors
2. `npx vitest run` — all 14 test files pass
3. `npm run dev` — app starts, navigate to `/`, sign in, create a thread, send a message, verify chat works end-to-end
4. No file in `components/` exceeds 200 lines
5. No file in `lib/` exceeds 350 lines (except `lib/models.ts` which is mostly data — leave it alone)
6. `lib/prisma.ts` no longer exists (moved to `lib/db/prisma.ts`)
7. `components/rag-lab.tsx` is a single re-export line
8. `lib/chat.ts` no longer exists (moved to `lib/chat/index.ts`)
9. All imports use `@/` path alias, no relative paths crossing directories
10. No barrel exports anywhere

## What NOT to do

- Do not touch `lib/models.ts`, `lib/retrieval.ts`, `lib/retrieval-weighting.ts`, `lib/wallet.ts`, `lib/providers.ts`, `lib/user-api-keys.ts`, or `lib/server-models.ts` — these are fine as-is.
- Do not touch the Python scraper (`src/`), data files (`data/`), or Prisma schema (`prisma/`).
- Do not refactor `components/admin-console.tsx`, `components/profile-page.tsx`, or `components/credentials-signin-form.tsx` — they're small enough.
- Do not add Tailwind, styled-components, or any CSS framework. Use CSS Modules only.
- Do not add React Context, Redux, Zustand, or any state management library. Plain hooks are fine.
- Do not add a logging framework. Keep `console.info` / `console.warn` / `console.error`.
- Do not modify `middleware.ts`, `app/layout.tsx`, or `app/page.tsx` (except the import path in page.tsx if absolutely necessary — but the re-export strategy in Priority 1c should prevent that).
