# 07 — API Contract

REST under `/api`. Session-cookie auth (NextAuth). All request and response bodies are Zod
schemas shared between the route handler and the client — one definition, no drift.

Conventions: `snake_case` never appears; ISO-8601 UTC timestamps; cursor pagination
(`?cursor=&limit=`); errors are
`{ error: { code: string, message: string, details?: unknown } }`.

## Onboarding & profile

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/me` | Current user, brand profile, connection + onboarding status |
| `PATCH` | `/api/me` | Update name, title, field, areas, audience, timezone, approval mode |
| `PATCH` | `/api/me/brand` | Tone, technicality, length, emoji, CTA, hashtags, first-person |
| `POST` | `/api/me/orcid` | Attach + verify ORCID |

## LinkedIn connection

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/linkedin/authorize` | 302 → LinkedIn OAuth (`openid profile email w_member_social`), PKCE + signed `state` |
| `GET` | `/api/linkedin/callback` | Exchange code, store encrypted tokens, resolve person URN |
| `GET` | `/api/linkedin/status` | `{ status, displayName, expiresAt, daysRemaining }` |
| `POST` | `/api/linkedin/disconnect` | Revoke locally, cancel scheduled posts |

Never returns a token, in any form, to any client.

## Research sources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sources` | List with sync status and paper counts |
| `POST` | `/api/sources` | `{ input }` — auto-detects kind (ORCID / arXiv / DOI / feed / URL) |
| `POST` | `/api/sources/preview` | Dry-run: what would this source find? No writes |
| `DELETE` | `/api/sources/:id` | Remove (papers are retained) |
| `POST` | `/api/sources/:id/sync` | Enqueue immediate sync |

`POST /api/sources` takes free text and routes it through each adapter's `parseInput`, so the user
pastes `0000-0002-1825-0097`, an ORCID URL, an arXiv author page, or a DOI, and it just resolves.
This is the highest-leverage UX detail in the product — it is the first thing every user does.

## Papers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/papers` | Inbox. Filters: `status`, `needsAttribution`, `hasDrafts` |
| `GET` | `/api/papers/:id` | Full record + authors + analyses + drafts |
| `POST` | `/api/papers` | Manual add by DOI/URL |
| `POST` | `/api/papers/:id/attribute` | Confirm/deny "this is my paper" |
| `POST` | `/api/papers/:id/dismiss` | Never generate content from this |
| `POST` | `/api/papers/:id/analyse` | Force re-analysis (new `PaperAnalysis` version) |

## Drafts

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/drafts` | Filter by status, date range |
| `GET` | `/api/drafts/:id` | Body, visual, verification report, source paper |
| `POST` | `/api/drafts` | `{ paperId, format? }` — generate |
| `PATCH` | `/api/drafts/:id` | Edit body/hashtags → sets `editedByUser`, **re-runs verification** |
| `POST` | `/api/drafts/:id/regenerate` | New draft, optionally a different format |
| `POST` | `/api/drafts/:id/approve` | → `APPROVED`, assigns next free slot |
| `POST` | `/api/drafts/:id/schedule` | `{ scheduledFor }` explicit time |
| `POST` | `/api/drafts/:id/publish` | Publish immediately |
| `DELETE` | `/api/drafts/:id` | Cancel |

A user edit re-runs verification. Users are not a trusted accuracy channel here — a well-meaning
paraphrase is exactly how a hedged finding becomes an overstated one.

## Schedule & calendar

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/schedule` | Slots + upcoming assignments |
| `PUT` | `/api/schedule/slots` | Replace the weekly slot set |
| `GET` | `/api/calendar?from=&to=` | Calendar view of scheduled + published |

## Visuals

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/visuals/:id` | Metadata + signed URL |
| `POST` | `/api/visuals/:id/regenerate` | Re-render, optionally a different template |
| `GET` | `/api/visuals/preview` | Render a `VisualSpec` without persisting (template dev) |

## Webhooks & internal

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/internal/cron/:name` | Cron entry points, shared-secret header |

---

## Security model

**Authn.** NextAuth sessions; httpOnly, secure, sameSite=lax cookies. Email magic link or
LinkedIn OIDC.

**Authz.** Every query is scoped by `userId` at the *service* layer, not the route layer.
Services take an explicit `actor` and never accept a bare ID without it. Postgres RLS is a
follow-up hardening step, not the primary control.

**Token storage.** LinkedIn access/refresh tokens are AES-256-GCM encrypted with a key from
`ENCRYPTION_KEY` (32-byte, base64). Distinct IV per record, auth tag stored alongside. Tokens are
decrypted only inside `src/services/linkedin/`, never logged, never serialised into any response.
Key rotation is supported via a versioned key prefix on the ciphertext.

**OAuth.** PKCE, signed and single-use `state` with a 10-minute TTL, exact-match redirect URI.

**Prompt injection.** Paper text is untrusted input — abstracts and PDFs can contain adversarial
instructions. Source content is always delivered inside a delimited user-role block, never
concatenated into a system prompt, and the system prompt states that content within the block is
data to be analysed and never instructions to follow. Extraction output is Zod-validated, so an
injected instruction cannot change the output *shape*; the evidence-containment check
(see [`05-ai-pipeline.md`](05-ai-pipeline.md)) is what stops it changing the output *content*.

**Rate limits.** Per-user limits on generation endpoints — these cost money and are the obvious
abuse surface.

**Publishing safety.**
- `LINKEDIN_DRY_RUN` blocks all real publishing in dev.
- Idempotency key per draft; no automatic retry on publish (see
  [`02-architecture.md`](02-architecture.md)).
- Retraction re-checked immediately before publish.
- A hard daily per-user publish cap as a runaway guard, well under LinkedIn's 150/member/day.

**Data deletion.** Account deletion cascades to sources, papers, analyses, drafts, and visuals,
and revokes LinkedIn tokens. Published LinkedIn posts are *not* deleted — we never had the right
to remove content from a member's feed without an explicit request, and doing so silently would
be worse than leaving it.
