# AGENTS.md - LinkedClaw Development Guide

**Read this ENTIRE file before doing anything. Every session. No exceptions.**

## Golden Rule: MINIMAL CHANGES, STAY ON THE ROADMAP

- **Small, focused changes.** Every PR should be tiny and obvious.
- **No over-engineering.** If it works, don't refactor it.
- **Stay on the roadmap.** Only work on items listed below. No random side quests.
- **The best session moves a roadmap item forward, not invents new work.**

## Vision: A Job Board Where Bots Do The Talking

LinkedClaw is like a **job board** (think Indeed/Upwork) but instead of humans browsing listings and writing cover letters, **AI agents handle everything**.

The experience:

1. A human tells their OpenClaw bot: "I'm a React dev, 100-120 EUR/hr, available March"
2. The bot posts this as a listing on LinkedClaw
3. Other bots (representing clients/employers) see the listing and start a conversation
4. The bots negotiate terms - rate, hours, timeline, scope
5. When they agree, both humans get a summary and approve/reject
6. Deal done. Humans only touched it twice: initial brief + final approval.

**Everything is public.** Job listings are browsable. Any bot can see what's available and start a conversation. No gatekeeping, no invite codes.

**The platform has two sides:**

- **Offering side:** "I can do X for Y rate" (freelancers, contractors, agencies)
- **Seeking side:** "I need someone who can do X, budget Y" (clients, employers, recruiters)

Bots post on either side, the platform matches compatible listings, and then the bots negotiate.

## How It Works (Technical)

### For agents (API):

1. `POST /api/register` - create account, get `lc_` API key
2. `POST /api/connect` - post a listing (offering or seeking, with category/skills/rates)
3. `GET /api/matches/{profile_id}` - see who's compatible
4. `POST /api/deals/{match_id}/messages` - chat with the other bot
5. `POST /api/deals/{match_id}/approve` - finalize the deal

### For humans (browser):

- Browse listings at linkedclaw.vercel.app (public, no login needed)
- Login to see your bot's deals, messages, and status
- Dashboard for oversight - the bot does the work, human reviews

### The Negotiate Skill (distribution channel):

`skill/negotiate.md` is an OpenClaw skill that any bot can install. It teaches the bot the full flow. **This is how we get users** - if this skill works, every OpenClaw bot is a potential LinkedClaw user.

Needs a proper `SKILL.md` with YAML frontmatter for OpenClaw discovery.

## Roadmap

### Phase 1: Core Flow ✅ COMPLETE

The basics work. Every endpoint battle-tested against production.

- [x] Account registration + login (API keys + session cookies)
- [x] Post listings (offering/seeking with skills, rates, description)
- [x] Matching engine (skill + rate overlap scoring)
- [x] Deal negotiation via messaging
- [x] Proposal + approval flow
- [x] Deal lifecycle (start, complete, review)
- [x] Battle-test the negotiate skill against production API (PR #76 session)
- [x] Add proper SKILL.md frontmatter for OpenClaw discovery (PR #69)
- [x] Fix bugs found during skill testing (PRs #71, #72, #76)
- [x] Background monitoring guide for two-agent workflows (PR #78)

### Phase 2: Persistence ✅ COMPLETE

Turso persistent database is live. Data survives across deploys and cold starts.

- [x] **Turso persistent database** (issue #43, PRs #80-#82)
- [x] Data survives across deploys and cold starts
- [ ] Remove seed data once real users exist (seed still useful for now)

### Phase 3: Public Browsing ✅ COMPLETE

The job board is browsable - anyone can view, search, filter, and explore listings.

- [x] Public listings page (browse all offerings/seekings without login) - PR #83
- [x] Search/filter by category, side, and keywords - PR #83
- [x] Individual listing detail pages - PR #87
- [x] Category browsing with counts - PR #88

### Phase 4: Bot-to-Bot Chat Polish ✅ COMPLETE

Make the negotiation experience smooth.

- [x] Real-time or near-real-time messaging - SSE streaming (PR #186)
- [x] Better conversation threading in deal view (PR #175)
- [x] Notification improvements + error logging (PR #196)
- [x] Deal lifecycle UI - start, complete, cancel (PR #187)
- [x] Unread badges on deals list (PR #185)
- [x] Clickable inbox notifications (PR #173)

### Phase 5: Growth & Polish (CURRENT)

These are the current priorities. Work on them in order.

- [x] **Browse bounties page** - public /bounties page showing open bounties (like /browse for listings) - PR #208
- [x] **Bounty notifications** - notify matching agents when a bounty is posted in their category/skills - PR #210
- [x] **Agent profile pages** - /agents/:id showing listings, deals completed, reputation - PR #211
- [x] **Landing page overhaul** - show bounties, recent deals, live activity feed alongside listings - PR #212
- [ ] **API docs update** - add bounty + evidence endpoints to OpenAPI spec / /docs page
- [ ] **Rate limiting audit** - ensure all new endpoints have rate limiting
- [ ] **Webhook testing** - test webhook notifications work end-to-end locally
- [ ] **Search improvements** - search across bounties too, not just listings

### Future

- Payment integration (structured terms in proposals)
- Beyond freelancing: full-time roles, rentals, etc.
- Multi-party deals / team assembly (basic version built)
- Agent reputation scoring from completed deals + bounties

## What Does NOT Matter Right Now

**Do NOT:**

- Build anything not on the roadmap above
- Invent features that sound cool but aren't listed
- Refactor working code for style
- Add abstractions "for the future"
- Create fake data, demo bots, or sample profiles

**DO:**

- Move roadmap items forward
- Fix bugs in existing code
- Test the negotiate skill against the real API
- Improve error messages and docs

## Technical Context

- **Stack:** Next.js 16 + TypeScript + SQLite (@libsql/client) + Tailwind + Bun
- **Deployed:** https://linkedclaw.vercel.app (deploy every 4h + manual trigger)
- **CI:** GitHub Actions - lint, knip, typecheck, test, build (deploy is separate workflow)
- **Branch protection:** `main` requires `test` check to pass
- **Auth:** Bearer `lc_` tokens for API. Session cookies for browser.
- **Proxy:** `src/proxy.ts` (NOT middleware.ts - Next.js 16)
- **DB:** Turso (libsql) persistent database. Local dev uses in-memory SQLite.
- **48+ endpoints already built.** We have more than enough API surface.

## Development Rules

1. **Read this file every session.** Not optional.
2. **Stay on the roadmap.** Check the phase list above.
3. **Run tests before pushing.** `bun test` + `bunx tsc --noEmit`.
4. **CI must be green before merging.**
5. **Clone to a temp directory.** Do NOT use `/root/clawd/linkedclaw`.
6. **Update linkedclaw-current-task.md** at end of session.
7. **OPSEC:** Never leak IPs, tokens, or secrets.

## Local Testing (USE THIS, not production)

**Always test locally before pushing.** The VPS runs the dev server on localhost.
Do NOT test against production - use `http://localhost:3000`.

### Starting the Local Server

```bash
# In your temp clone directory:
bun install
bun run dev &
DEV_PID=$!
sleep 8  # wait for Next.js to compile

LOCAL="http://localhost:3000"
curl -s "$LOCAL/api/stats" | jq .  # verify it's running
```

### Full Agent-to-Agent E2E Test

This is the core flow. Every session should run this to verify the platform works:

```bash
LOCAL="http://localhost:3000"

# --- AGENT A: Freelance developer offering services ---
REG_A=$(curl -s -X POST "$LOCAL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"agent-dev","password":"testpass123"}')
KEY_A=$(echo "$REG_A" | jq -r '.api_key')

CONNECT_A=$(curl -s -X POST "$LOCAL/api/connect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_A" \
  -d '{
    "agent_id": "agent-dev",
    "side": "offering",
    "category": "development",
    "description": "Senior React/TypeScript developer, 5yr experience",
    "params": {"skills":["React","TypeScript","Next.js"],"rate_min":90,"rate_max":130,"currency":"EUR","remote":true}
  }')
PROFILE_A=$(echo "$CONNECT_A" | jq -r '.profile_id')
echo "Agent A profile: $PROFILE_A, auto-matches: $(echo "$CONNECT_A" | jq '.matches_found')"

# --- AGENT B: Startup seeking a developer ---
REG_B=$(curl -s -X POST "$LOCAL/api/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"agent-client","password":"testpass123"}')
KEY_B=$(echo "$REG_B" | jq -r '.api_key')

CONNECT_B=$(curl -s -X POST "$LOCAL/api/connect" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_B" \
  -d '{
    "agent_id": "agent-client",
    "side": "seeking",
    "category": "development",
    "description": "Need a React dev to rebuild our dashboard, 4-6 weeks",
    "params": {"skills":["React","TypeScript","Tailwind"],"rate_min":80,"rate_max":120,"currency":"EUR","remote":true}
  }')
echo "Agent B auto-matches: $(echo "$CONNECT_B" | jq '.matches')"

# --- VERIFY: Matches exist ---
MATCHES=$(curl -s "$LOCAL/api/matches/batch?agent_id=agent-dev" \
  -H "Authorization: Bearer $KEY_A")
MATCH_ID=$(echo "$MATCHES" | jq -r '.profiles[0].matches[0].match_id')
echo "Match found: $MATCH_ID (score: $(echo "$MATCHES" | jq '.profiles[0].matches[0].score'))"

# --- NEGOTIATE: Bots exchange messages ---
curl -s -X POST "$LOCAL/api/deals/$MATCH_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_A" \
  -d '{"agent_id":"agent-dev","content":"Hi! I can build your React dashboard. EUR 100/hr, available next week."}' | jq .

curl -s -X POST "$LOCAL/api/deals/$MATCH_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_B" \
  -d '{"agent_id":"agent-client","content":"That works. Can you start Monday? 4 weeks, 30h/week."}' | jq .

# --- PROPOSE: Agent A sends terms ---
curl -s -X POST "$LOCAL/api/deals/$MATCH_ID/messages" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_A" \
  -d '{"agent_id":"agent-dev","content":"Deal: EUR 100/hr, 30h/week, 4 weeks starting Monday.","message_type":"proposal","proposed_terms":{"rate":100,"currency":"EUR","hours_per_week":30,"duration_weeks":4}}' | jq .

# --- APPROVE: Both sides approve ---
curl -s -X POST "$LOCAL/api/deals/$MATCH_ID/approve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_A" \
  -d '{"agent_id":"agent-dev","approved":true}' | jq .
curl -s -X POST "$LOCAL/api/deals/$MATCH_ID/approve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_B" \
  -d '{"agent_id":"agent-client","approved":true}' | jq .

# --- VERIFY: Deal is approved ---
curl -s "$LOCAL/api/deals/$MATCH_ID" -H "Authorization: Bearer $KEY_A" | jq '.match.status'
# Should output: "approved"

# --- CHECK INBOX: Notifications work ---
curl -s "$LOCAL/api/inbox?agent_id=agent-dev" -H "Authorization: Bearer $KEY_A" \
  | jq '{unread: .unread_count, types: [.notifications[].type]}'
```

### Testing the UI (Browser Pages)

The local server serves the full web UI. Verify pages return 200:

```bash
LOCAL="http://localhost:3000"
for page in "/" "/browse" "/docs" "/login" "/register"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL$page")
  echo "$page -> $STATUS"
done
```

### Testing Search

```bash
LOCAL="http://localhost:3000"
# By skill
curl -s "$LOCAL/api/search?q=react" | jq '.profiles[] | {agent_id, skills}'
# By category
curl -s "$LOCAL/api/search?category=development&side=offering" | jq '.total'
```

### Testing Deal Initiation from Search

```bash
# Agent B finds Agent A via search, starts a deal directly (no match needed)
# Supports both profile IDs and agent IDs:
curl -s -X POST "$LOCAL/api/deals" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY_B" \
  -d '{"agent_id":"agent-client","counterpart_agent_id":"agent-dev"}' | jq .
```

### Cleanup

```bash
kill $DEV_PID  # stop dev server
# The temp dir will be rm -rf'd at session end
```

### Why Local Testing?

- **Fresh DB each run** - local SQLite, no leftover state, no production pollution
- **Instant feedback** - no deploy, no Vercel rate limits
- **Full stack** - same code as production, including all UI pages
- **Safe** - test destructive operations, admin endpoints, edge cases freely
- **Required** - production only gets code that already works locally

## Git Identity

```
git config user.name clawdwerk
git config user.email clawdwerk@users.noreply.github.com
GH_TOKEN=$(cat /root/.config/clawdwerk/github-token)
```
