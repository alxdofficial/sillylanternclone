# Hosted Story Studio

The invite-only beta runs one Node service on Railway and uses Supabase Auth, Postgres, and private Storage. The local release stays on `main` and Railway deploys `hosted`. Land shared harness, prompt, and engine fixes on `main`, then merge `main` into `hosted` and run both runtime paths.

### Beta setup

1. Apply the migration in `supabase/migrations/` to the dedicated Supabase project. It defines beta entitlements, per-account libraries and metadata, revision-aware writes, encrypted provider key storage, and private object policies.
2. Configure Google sign-in and invite writers by email as described below. Setting an account’s `enabled` flag to false revokes access.
3. Set Railway service variables `STORY_STUDIO_ORIGIN` (the full HTTPS URL), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `STORY_STUDIO_ENCRYPTION_KEY` (32 random bytes, base64url). The encryption key protects browser sessions and saved provider credentials, so back it up separately. Replacing it invalidates sessions and saved keys. The app uses authenticated Supabase requests with row-level security.
4. Connect the Railway service to the `hosted` branch. `railway.toml` starts the hosted runtime and checks `/healthz`. Verify access with two test accounts before giving the URL to writers.

### Google sign-in

Create a Google Cloud OAuth **Web application** client with the Supabase provider callback as its authorized redirect URI. Paste the client ID and secret into Supabase **Authentication → Sign In / Providers → Google**. In Supabase **Authentication → URL Configuration**, set the Railway HTTPS site URL and allow exactly the app's `/api/account/google/callback` URL. Set `STORY_STUDIO_GOOGLE_LOGIN=1` in Railway after both sides are configured. If Google Auth Platform is in testing mode, add each Google email as a test user there as well.

Add each verified Google email to `public.story_studio_google_invites`, with `can_bring_key` true only for approved users. The first sign-in redeems the invite into an account. To revoke a redeemed invite, disable its account and the invite. Google is the hosted beta’s sign-in method.

The beta has no public sign-up, shared provider budget, or live collaboration. An approved user can enter a provider key in Settings and is billed by that provider. AI calls and analysis use the existing provider adapters. Hosted background review is opt-in and progresses while the writer is signed in. Writers can import their local library from a Story Studio export. The hosted demo starts fresh and the two runtimes have separate story data.

The scaling and billing proposals below are planning estimates in USD, checked on 18 November 2026.

## Deployment and data

| Component | Private beta | When usage grows |
| --- | --- | --- |
| Accounts, manuscripts, credits, job queue | Supabase Auth, Postgres, row-level security and Queues. Free during internal development. Pro starts at $25/month and includes a Micro instance, daily backups and 100 GB of file storage. | Pool database connections, index by workspace and project, and upgrade database compute based on queue pressure and query latency. |
| Web API and AI worker | Deploy one Node image with separate web and worker entry points. Railway Hobby starts at $5/month. Pro starts at $20/month, including $20 of usage. | Scale workers independently. Use private networking and put the API, worker and database in the same supported region. |
| Images and export files | Private Supabase Storage, short-lived download links, and a placement record in Postgres. | Move image blobs or download traffic to private R2 when usage warrants it. R2 Standard includes 10 GB-month free and charges $0.015 per additional GB-month, with no direct egress fee. |

An internal prototype can start near $5/month plus model usage, subject to the free database inactivity pause. A paid launch starts near $45/month before inference, payment fees, domain, transactional email and overages. As a resource example, Supabase Medium plus a Node workload averaging 2 GB RAM, 1 vCPU and 100 GB outbound transfer, and 100 GB of R2 images, is about $121/month before request overages and model spend. Benchmark the worker at 512 MB–1 GB with one job per process first. Large image responses and export ZIPs determine the memory headroom. Track queue age, memory and throughput before raising concurrency. Cloudflare Workers can handle static assets and lightweight new services. The current Node filesystem, ZIP and image paths fit the container deployment directly. [Supabase pricing](https://supabase.com/pricing) · [Railway pricing](https://railway.com/pricing) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### One codebase

- Share the browser, model adapters, story context, validated tools, import/export, revision logic and image pipeline. Extract request-independent orchestration functions from `server.mjs` for both runtimes to call. Keep loopback, file storage and optional stdio MCP in the local runtime. Use separate hosted adapters for Postgres, private objects, authentication, billing and durable jobs.
- Keep the existing story shape at the harness boundary. Store canonical cast, world, notes and graph data per project. Give each scene a stable ID and revision. Move chapter order, job status, membership, versions and the credit ledger into their own records. Round-trip existing alternates, graph provenance and context-exclusion flags through import/export. Create a separate copy of the demo for each account.
- A job contains a project ID, expected revision, named action and allowed model route. The server authenticates membership and loads the source snapshot. The worker runs bounded tool calls and checks permission and revision again before saving. Queue messages carry IDs. Model credentials stay in the server secret store. Keep production logs to request IDs, durations, outcomes and measured usage by default.

## Future collaboration

Start with owner, editor and viewer roles, email-bound expiring invitations, and project-scoped authorization in Postgres. Give spending its own permission and workspace budget. Use Presence for who is viewing or editing. Broadcast revision notices over a private channel, then fetch authorized data from the API. Apply revocations to all reads, edits, jobs and new download links. [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)

**Ship scene-level collaboration first.** Different scenes can save independently. A save includes the expected scene revision and a retry ID. On a same-scene conflict, keep both drafts and show a diff. Chapter order and graph changes use a separate project revision. Add a short server-issued edit lease only if authors regularly collide. AI produces a proposal tied to the exact source revision, with a diff if a collaborator has since changed the source. Restoring a version creates a new revision.

If customers need simultaneous typing in one scene, use one Yjs document per scene with one persistence backend. Liveblocks is the lower-operations option. Hocuspocus is the self-hosted Node option. Keep graph, permissions, billing and chapter order in Postgres. Materialize saved Yjs revisions for exports and AI, and advance the document generation on restore so offline clients cannot reapply edits from before the restore. Test overlapping edits, disconnected recovery, revocation, duplicate autosaves, undo, restore and an AI proposal arriving after a human edit. [Yjs](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) · [Liveblocks pricing](https://liveblocks.io/pricing) · [Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence)

## Plans, payments and credits

FigureLabs offers welcome credits, included monthly credits, add-on purchases and team allowances. Its annual pricing page shows Starter at $9/month with 1,000 credits, Plus at $26 with 5,000 and Pro at $74 with 20,000. Different actions use different amounts. Adopt that structure with prices calibrated to fiction workflows. [FigureLabs pricing](https://www.figurelabs.ai/pricing)

| Proposed offer | Included credits | Example budget |
| --- | ---: | --- |
| Trial | 150 once | $0.30 upper target for inference, enough for a few real actions |
| Writer, $12/month | 1,200 | $2.40 maximum target for included inference |
| Studio, $24/month | 2,800 | $5.60 maximum target for included inference |
| Top-up, $8 | 1,000 | $2.00 target for inference |

For planning, allow up to $0.002 of provider cost per credit. Test a standard scene with continuity at 25 credits and a premium scene at 45. Offer separate quotes for unusually long jobs, paid background reviews and image jobs that need new references. Show the quote before running. Use the measured 95th percentile cost, including retries, to choose final prices and input/output limits. The $12 example leaves about 73% after the target inference cost and domestic Stripe card plus Billing fees, before infrastructure, support, tax, chargebacks and collaboration. This is a contribution estimate with full credit usage.

Reserve credits and create a queued job in one database transaction. Use stable job, stage and billing event IDs. Settle once after persisting usable work. Release unused reservations and failed-job charges. Record provider cost separately so you can reconcile ambiguous timeouts and account for wasted attempts. Use signed payment webhooks to grant a subscription or top-up after payment and add compensating ledger entries for refunds. An opt-in background review can spend against a visible project budget. [Supabase Queues](https://supabase.com/docs/guides/queues) · [Stripe billing webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

For eligible Hong Kong merchants, Stripe lists 3.4% plus US$0.30 for domestic USD cards, with 0.7% for Billing. International cards and currency conversion can cost extra. Paddle’s merchant-of-record pricing is 5% plus $0.50. Product eligibility is separate from merchant location. Stripe specifically restricts mature literature or imagery intended for sexual gratification, including AI generation. Paddle restricts sexually oriented offerings. Get written eligibility for the actual hosted product and specialist underwriting if explicit generation is central. Direct OpenAI and Anthropic API region lists omit Hong Kong. Check provider and end-user eligibility for every route. OpenRouter’s terms pass through applicable model terms. [Stripe Hong Kong pricing](https://stripe.com/en-hk/pricing) · [Stripe Billing](https://stripe.com/billing/pricing) · [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses) · [Paddle pricing](https://www.paddle.com/pricing) · [Paddle acceptable use](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle) · [OpenAI regions](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories) · [Anthropic regions](https://platform.claude.com/docs/en/api/supported-regions) · [OpenRouter terms](https://openrouter.ai/terms)

## Provider economics

OpenRouter Standard charges 5.5% when loading funds. Business charges 8%. Standard offers many models with one integration. Using company-owned provider keys through OpenRouter has a $25,000 monthly inference allowance before a 5% fee on usage above it. Compare actual endpoint prices, tool support, data terms and cache economics. At equal inference prices, using a direct API avoids $275 per month of Standard fees on $5,000 of routed spend. A new route costing $300/month to operate would break even around $5,455/month at that fee difference. [OpenRouter pricing](https://openrouter.ai/pricing) · [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)

| Action | Candidate route | Illustrative provider cost |
| --- | --- | --- |
| Economy continuity, Story Flow or bounded artwork planning | Qualified DeepSeek V4.1 Flash endpoint | About $0.003 before funding fees at 15,000 uncached input and 1,500 billed output tokens on the observed $0.14/$0.42 endpoint |
| Standard prose and economy continuity | Terra prose and DeepSeek continuity | About $0.042 through OpenRouter Standard at 12,000 uncached prose input and 5,000 billed prose output tokens |
| Premium prose and economy continuity | Sonnet 5.5 prose and DeepSeek continuity | About $0.081 through OpenRouter Standard at the same sizes |
| Illustration or comic | Bounded planning and FLUX 3 Image Klein | $0.009 rendering at 1K plus planning and $0.008 per new 768 px reference |

The live Late Ferry update spent $0.2464 on ten Sonnet calls, including prose, continuity, suggestions and image planning, plus $0.05 on six renders. Treat this as a measured example. Compare candidate routes on cost per approved scene, successful tool update or accepted image, including retries and paid work the user discards. Cache stable prompt prefixes, measure billed reasoning and cache costs, and queue delay-tolerant work for batch discounts where quality holds. Use the existing direct adapters where eligibility and measured unit economics support them. [OpenAI Terra rates](https://developers.openai.com/api/docs/models/gpt-6.1-terra) · [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [OpenRouter DeepSeek model](https://openrouter.ai/deepseek/deepseek-v4.1-flash) · [FLUX pricing](https://bfl.ai/pricing)

### Beyond the private beta

1. Start with private accounts, faithful local import/export, provider allowlists and a durable job queue.
2. Verify debits and refunds through retry, timeout, cancellation and payment webhook replay. Add subscriptions only after the measured action costs and payment eligibility are clear.
3. Add invited collaboration with private links, presence, revision conflicts and accessible diffs. Use live co-typing when user testing demonstrates the need.
