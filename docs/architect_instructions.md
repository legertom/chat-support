# Architecture Review: chat-support

## Executive Summary

This is a **~14,000-line hybrid monorepo** (Next.js 15 + Python scraper) powering a RAG-based support assistant with multi-model routing, budget controls, and BYOK encryption. For an AI-maintained codebase, the architecture is **surprisingly coherent** — clean dependency direction, no circular imports, consistent error patterns, and strong type safety. The main risks are concentrated in a few oversized files rather than systemic architectural flaws.

**Overall Rating: 7/10** — Strong fundamentals, but 3-4 files carry outsized complexity that will degrade AI maintainability over time.

---

## Strengths

### 1. Clean Layered Architecture (9/10)
The dependency graph flows in one direction: `app/api/ -> lib/ -> prisma`. No circular dependencies were detected across 75+ TypeScript files. Each `lib/` module has a clear single domain. This is the #1 thing an AI-maintained codebase needs to get right, and it does.

### 2. Type Safety End-to-End (9/10)
Strict TypeScript, Prisma-generated types, Zod validation on all API inputs, and typed routes. This creates a safety net that makes AI edits far less risky — the compiler catches most mistakes before they ship.

### 3. Thin API Controllers (8/10)
Most routes are 40-60 lines, delegating to `lib/` immediately. The `POST /api/chat` route is 47 lines — it validates, delegates to `lib/chat.ts`, and returns. This is the correct pattern for AI maintenance because routes rarely need changes.

### 4. No Barrel Exports (8/10)
Every import is `@/lib/specific-file`, not `@/lib/index`. This is ideal for AI agents — it makes dependency tracking explicit and avoids the "change one thing, break everything" barrel export problem.

### 5. Security Hardening (8/10)
AES-256-GCM BYOK encryption with versioned payloads, audit trails with request-ID correlation, RBAC enforcement, rate limiting, and optimistic locking on wallet operations. The security model is production-grade and well-tested (dedicated test files for auth, RBAC, BYOK, and provider security).

### 6. Well-Factored Python Pipeline (8/10)
The `src/support_scraper/` package has 16 small, focused modules (~150 lines average). Each has a single responsibility: `fetcher.py` fetches, `chunker.py` chunks, `robots.py` handles robots.txt. This is what the TypeScript side should aspire to.

### 7. Comprehensive Test Coverage (7/10)
15 TypeScript test files + 5 Python test files covering core business logic, security boundaries, and API routes. The tests focus on the highest-risk areas (wallet, BYOK, auth) rather than trivial functionality.

### 8. Budget Atomicity Pattern (8/10)
The Reserve -> Execute -> Finalize wallet pattern with optimistic locking (`WHERE balanceCents >= amount`) is a genuinely clever design that prevents overspend without complex distributed transactions.

---

## Weaknesses

### 1. God Component: `components/rag-lab.tsx` — 1,216 lines (3/10)

This is the biggest maintainability risk. A single component with:
- **32 `useState` hooks**
- **4 `useEffect` hooks**
- **28 inline event handlers**
- **12 async functions**
- **5 `useMemo` computations**

It manages user profile, thread list, thread detail, message state, API key management, model selection, retrieval config, wallet display, and feedback forms — all in one file. For an AI agent, editing this file is high-risk because any change could accidentally break unrelated state interactions.

### 2. Fat Orchestrator: `lib/chat.ts` — 471 lines (4/10)

The main `chat()` function has **14 distinct responsibilities**: thread validation, message creation, model resolution, BYOK decryption, parameter clamping, history retrieval, retrieval integration, budget reservation, provider calling, cost calculation, DB transactions, wallet finalization, audit logging, and error cleanup. It imports from 13 different modules. This is the file most likely to accumulate merge conflicts and regressions.

### 3. Infrastructure Leak: `lib/prisma.ts` — 264 lines (5/10)

A Prisma client file should be ~20 lines. This one has absorbed database incident response hardening: 7 candidate environment variables for DB URLs, Neon pooler hostname detection, credential fallback injection, SSL parameter injection, and WebSocket polyfill setup. The ops concern has overwhelmed the original purpose.

### 4. Monolithic CSS: `app/globals.css` — 2,054 lines (4/10)

All styles in a single file with no modular organization. No CSS modules, no Tailwind, no co-location. AI agents editing styles here risk unintended cascade effects because there's no scoping mechanism.

### 5. Business Logic Leaking into Routes

Several routes exceed their "thin controller" mandate:
- `app/api/threads/[id]/route.ts` (140 lines) — contains feedback aggregation logic
- `app/api/me/route.ts` (150 lines) — contains token aggregation and type coercion
- `app/api/me/keys/[id]/route.ts` (216 lines) — heavy audit logging duplication

### 6. No Global Error Boundary

React components catch errors locally (9 catch blocks in rag-lab.tsx), but there's no `error.tsx` boundary at the app level. An unhandled throw in any component crashes the entire page with no recovery path.

### 7. In-Memory BM25 Scaling Ceiling

The retrieval system loads all 1,692 chunks into RAM and builds a term-frequency index on startup. This works now but becomes a deployment problem at ~10K+ chunks — cold starts slow down, memory usage grows linearly, and there's no persistence or caching layer.

---

## Recommendations

### Priority 1: Decompose the God Component

Break `rag-lab.tsx` into ~8 focused components:

```
components/
  chat/
    chat-page.tsx          # Layout shell (~100 lines)
    thread-list.tsx        # Sidebar with filtering
    thread-detail.tsx      # Message history + feedback
    chat-composer.tsx      # Input + model selector
    message-feedback.tsx   # Per-message feedback
    thread-feedback.tsx    # Thread-level feedback
  hooks/
    use-threads.ts         # Thread CRUD + polling
    use-user-profile.ts    # Profile + wallet
    use-model-catalog.ts   # Model list + selection
  api-client/
    index.ts               # Typed fetch wrappers
```

**Why this matters for AI maintenance:** An AI agent asked to "add a new field to the thread list" would be editing a 150-line file with 3 state variables instead of a 1,200-line file with 32. The blast radius drops by an order of magnitude.

### Priority 2: Break Up the Chat Orchestrator

Refactor `lib/chat.ts` into a pipeline:

```
lib/chat/
  index.ts                   # Public API (~50 lines)
  prepare-request.ts         # Validate thread, resolve model, decrypt keys
  execute-turn.ts            # Retrieve chunks, call provider
  finalize-response.ts       # Save messages, finalize wallet, audit
```

Each stage is independently testable and has 4-5 responsibilities max.

### Priority 3: Extract DB Connection Logic

Move the URL resolution and Neon adapter logic out of `lib/prisma.ts`:

```
lib/db/
  prisma.ts                  # Client init (~30 lines)
  connection-resolver.ts     # URL selection + fallbacks
  neon-adapter.ts            # Pooler detection + adapter setup
```

### Priority 4: Modularize CSS

Adopt CSS Modules (zero-config in Next.js):
```
components/chat/
  thread-list.tsx
  thread-list.module.css
  chat-composer.tsx
  chat-composer.module.css
```

This co-locates styles with components and provides automatic scoping, eliminating cascade risk.

### Priority 5: Add Error Boundaries

Create `app/error.tsx` and `app/global-error.tsx` for graceful recovery from unhandled errors.

### Priority 6: Extract Route Business Logic

Move aggregation/transformation logic from routes into `lib/`:
- Thread feedback aggregation -> `lib/threads.ts`
- User stats computation -> `lib/user-stats.ts`
- Audit logging pattern -> shared middleware or decorator

---

## AI Maintainability Scorecard

| Dimension | Score | Notes |
|---|---|---|
| **File size discipline** | 6/10 | 4 files over 400 lines; Python side exemplary |
| **Single responsibility** | 6/10 | Most files good; rag-lab.tsx and chat.ts fail |
| **Dependency clarity** | 9/10 | No circular deps, no barrels, explicit imports |
| **Type safety** | 9/10 | Strict TS + Prisma + Zod across the board |
| **Test coverage** | 7/10 | Core logic covered; UI untested |
| **Error consistency** | 7/10 | ApiError pattern consistent; some swallowed errors |
| **Security posture** | 8/10 | BYOK, RBAC, rate limiting, audit trails |
| **Naming conventions** | 8/10 | Consistent kebab-case files, PascalCase components |
| **Documentation** | 7/10 | Good README, AGENTS.md, runbooks; inline docs sparse |
| **Deployment maturity** | 7/10 | CI for scraper; no staging env visible |

**Composite Score: 7.4/10**

The codebase is in strong shape for its size and purpose. The main risk is that the 3-4 oversized files will become increasingly difficult for AI agents to modify safely as features are added. Addressing Priorities 1-3 would raise this to an 8.5+/10 and significantly reduce the chance of AI-introduced regressions.
