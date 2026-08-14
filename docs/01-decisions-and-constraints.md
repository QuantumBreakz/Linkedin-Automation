# 01 — Decisions & Constraints

Everything here was verified against live documentation or a live API call on 2026-08-14.
Where something is *unverified*, it says so explicitly and names the spike that will settle it.

---

## D1 — Publishing does NOT require LinkedIn partner approval

This was the biggest open risk and it resolves in our favour.

| Product | Access | Grants | Needed for |
| --- | --- | --- | --- |
| Sign In with LinkedIn using OpenID Connect | **Self-serve** | `openid`, `profile`, `email` | Person URN (`sub`), name, avatar |
| Share on LinkedIn | **Self-serve** | `w_member_social` | Creating posts on behalf of the member |
| Community Management API | **Partner-gated** (verified company, Page, 2-tier review, screencast; 4–8 weeks fast path, 3–4 months typical) | Org pages, post analytics, comment moderation | Analytics only |

Add both self-serve products from the app's **Products** tab in the LinkedIn Developer Portal.

**Rate limits (member token):** 150 requests/member/day, 100,000/app/day. A 3-posts-per-week
schedule uses ~0.4% of the member budget. Rate limiting is a non-issue.

**Consequence:** the entire core loop — connect → discover → analyse → generate → visualise →
schedule → publish — ships without any partner application. We apply for Community Management
API in parallel, but nothing blocks on it.

## D2 — Analytics is the gated half, so it moves to last

Member post analytics (impressions, engagement) requires the partner-gated Community Management
API. The rough plan's §16 assumed this was available; it is not, at least not initially.

**Decision:** `PostMetric` exists in the schema from day one with a `source` discriminator
(`MANUAL` | `API`). MVP ships publishing with **no** analytics. The performance-based format
selection described in §16 of the plan is explicitly a post-partner-approval feature. Do not
build the recommendation engine against data we cannot yet collect.

## D3 — Token refresh is partner-gated: design for 60-day re-auth

> "LinkedIn supports programmatic refresh tokens for all approved Marketing Developer Platform
> (MDP) partners."

Self-serve apps get a **60-day access token and no refresh token**. This directly contradicts the
"set it and forget it forever" promise, and it is not something we can engineer around.

**Decision — treat token expiry as a first-class product surface:**

- Store `expiresAt` on `LinkedInAccount`; a daily job flags accounts inside a 14-day window.
- Email the user at T-14, T-3, and T-0 with a one-click reconnect link.
- On expiry, the schedule **pauses** — queued drafts are retained, never silently dropped, and
  never published late in a burst once reconnected.
- The OAuth adapter is written to consume `refresh_token` / `refresh_token_expires_in` *if
  present*, so the day we are approved as an MDP partner this becomes a config change, not a
  rewrite.

Honest framing for the landing page: "about a minute every two months", not "fully autonomous".

## D4 — Drop Google Scholar and ResearchGate from the roadmap

Google Scholar has **no official API**, and automated querying violates Google's Terms of
Service. ResearchGate likewise prohibits automated access. Every "Google Scholar API" on the
market is an unofficial scraper.

This matters more than usual for us: our users are named, identifiable academics. Getting their
publication record via a ToS-violating scraper — or getting our IP ranges blocked mid-schedule —
is both a legal and a reliability problem.

**Decision:** **OpenAlex + ORCID replace Google Scholar** as the primary author-profile
connector. Verified live against the real API (no key, HTTP 200):

```
GET https://api.openalex.org/works?filter=author.orcid:0000-0003-1613-5981&mailto=you@example.com
```

Returns `count`, and per work: `doi`, `title`, `publication_date`, `abstract_inverted_index`,
`authorships[].author.orcid`, `open_access.{is_oa,oa_url}`, `primary_location`, `best_oa_location`,
`topics`, `keywords`, `has_fulltext`, **`is_retracted`**, `referenced_works`, `cited_by_count`.

That is a superset of what we would have scraped from Scholar, it is free, key-less, and it is
author-centric — exactly the shape our product needs.

Scholar and ResearchGate remain supported in exactly one way: the user pastes an individual paper
URL or DOI, which we resolve through Crossref/OpenAlex. We never crawl the profile.

## D5 — Source tiers

| Tier | Sources | Status |
| --- | --- | --- |
| **A — MVP** | OpenAlex, ORCID, arXiv, PubMed (E-utilities), Crossref, DOI resolution, Unpaywall, generic RSS/Atom | Free, documented, key-less or free-key |
| **B — Later** | Semantic Scholar (free key), Springer, Elsevier/ScienceDirect, IEEE | Need keys, some need agreements |
| **C — Never crawled** | Google Scholar, ResearchGate | Manual paper-URL/DOI paste only |

Politeness budgets we must honour, encoded in the rate limiter per connector:

- **arXiv** — 3s delay between consecutive calls; `max_results` ≤ 2000/slice, 30000 total.
- **PubMed E-utilities** — 3 req/s without a key, 10 req/s with one; `tool` and `email`
  parameters are required and must be registered with NCBI.
- **OpenAlex** — send `mailto=` to stay in the polite pool.
- **Crossref / Unpaywall** — send a `User-Agent` with a contact mailto.

## D6 — Full text is the real accuracy bottleneck

Most records give us **title + abstract only**. The rough plan's §7 asks the LLM to extract
methodology, dataset, limitations, and "important numbers". From an abstract alone, a model will
confabulate every one of those fields — and it will do so fluently.

This is the single largest technical risk to the product's core promise. See
[`05-ai-pipeline.md`](05-ai-pipeline.md) for the full treatment. The short version:

- Every extracted field is **nullable** and carries a `provenance` tag
  (`STATED` | `INFERRED` | `ABSENT`) plus a verbatim `evidence` span from the source.
- Fields with no evidence span are `null`. Not guessed.
- Content templates degrade gracefully when fields are `null` — a paper with abstract-only
  coverage gets a "Key Finding" post, never a "Methodology Deep Dive".
- We fetch open-access full text when `open_access.is_oa` is true (arXiv PDF, PMC OA subset,
  Unpaywall `oa_url`) and record `fullTextStatus` so the pipeline knows what it is working from.

## D7 — Retraction and correction checks are mandatory, not optional

A tool that auto-posts a doctor's retracted paper to their professional network causes real
career damage. OpenAlex exposes `is_retracted`; Crossref exposes update-to relationships.

**Decision:** retraction status is checked at discovery **and re-checked immediately before
publish**. A paper that becomes retracted between scheduling and publishing has its queued drafts
cancelled and the user notified. This is a hard gate with no override.

## D8 — OpenRouter free models: fine for development, not an architectural assumption

Free-tier OpenRouter models have hard daily caps, aggressive rate limits, and rotate in and out of
availability without notice. For the *verification* stage of a scientific-accuracy product they
are the wrong tool.

**Decision:** the LLM layer addresses **roles**, not models:

| Role | Used for | Dev default | Production intent |
| --- | --- | --- | --- |
| `cheap` | classification, tagging, dedup assistance | free model | small paid model |
| `standard` | extraction, drafting | free model | mid-tier model |
| `verify` | claim checking, retraction/number audit | free model | strongest available |

Each role maps to an ordered **fallback chain** of model IDs in config. A 429 or a deprecated
model falls through to the next entry rather than failing the job. No model ID appears anywhere
outside config.

## D9 — Neither baseline repo is a code baseline

| Repo | What it is | What we take |
| --- | --- | --- |
| `tsu-ki/LinkedIn-Automation` | 806-line Selenium script; logs in with the user's LinkedIn **password**, stealth flags, scrapes DMs, auto-removes connections; "scheduling" is a `time.sleep()` loop | **Nothing.** Credential login + browser automation violates LinkedIn's User Agreement and gets member accounts restricted. It is the approach we are explicitly not taking. Useful only as a worked example of the failure mode. |
| `JithinBathula/LinkedIn_Post_Generator` | Streamlit + LangChain + Groq; few-shot style matching from CSV exports; JSON-schema extraction with an output parser | **Two ideas, not code.** (1) Few-shot style matching from a user's own prior posts → our Brand Layer. (2) Forcing structured JSON out of the model for metadata → our extraction schema. Both are re-implemented in TypeScript against our own schema. |

Neither is multi-tenant, has a database, a job queue, real scheduling, OAuth, or visuals. We start
fresh; the borrowed ideas are the two above.

---

## Open questions for the Phase-1 spike

These need a real registered LinkedIn app to settle. None of them block design.

1. **Which posting surface does `w_member_social` accept?** The consumer self-serve docs document
   `POST /v2/ugcPosts` with `assets?action=registerUpload`. The newer versioned API is
   `POST /rest/posts` with `images?action=initializeUpload` and a `LinkedIn-Version: YYYYMM`
   header, but its examples all use *organization* URNs. We must confirm whether `/rest/posts`
   accepts a `urn:li:person:` author under `w_member_social`.
   → The adapter implements **both**, defaults to `/rest/posts`, falls back to `/v2/ugcPosts`.
2. **Does the self-serve token response ever include `refresh_token`?** Docs say MDP partners
   only. Confirm empirically before we commit the re-auth UX copy.
3. **Image upload recipe for member posts** — `urn:li:digitalmediaRecipe:feedshare-image` with
   `owner` as the person URN. Confirm end-to-end with a real render.

---

## Sources

- [Share on LinkedIn (self-serve)](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [Refresh Tokens with OAuth 2.0](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)
- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [Community Management API product](https://developer.linkedin.com/product-catalog/marketing/community-management-api)
- [OpenAlex API](https://api.openalex.org/) (probed live)
- [arXiv API user manual](https://info.arxiv.org/help/api/user-manual.html)
- [NCBI E-utilities usage guidelines](https://www.ncbi.nlm.nih.gov/books/NBK25497/)
