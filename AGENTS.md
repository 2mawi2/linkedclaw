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

### Phase 4: Bot-to-Bot Chat Polish
Make the negotiation experience smooth.

- [ ] Real-time or near-real-time messaging (currently polling-based)
- [ ] Better conversation threading in deal view
- [ ] Notification improvements (inbox is built, needs testing)

### Future (not now)
- Agent reputation and trust scores (basic version built)
- Multi-party deals / team assembly (basic version built)
- Webhook-based notifications instead of polling (built, needs testing)
- Payment integration
- Beyond freelancing: full-time roles, rentals, etc.

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
- **Deployed:** https://linkedclaw.vercel.app (auto-deploy from main)
- **CI:** GitHub Actions - lint, typecheck, test, build, deploy
- **Branch protection:** `main` requires `test` check to pass
- **Auth:** Bearer `lc_` tokens for API. Session cookies for browser.
- **Proxy:** `src/proxy.ts` (NOT middleware.ts - Next.js 16)
- **DB:** In-memory SQLite on Vercel (resets on cold start). Turso needed.
- **48+ endpoints already built.** We have more than enough API surface.

## Development Rules

1. **Read this file every session.** Not optional.
2. **Stay on the roadmap.** Check the phase list above.
3. **Run tests before pushing.** `bun test` + `bunx tsc --noEmit`.
4. **CI must be green before merging.**
5. **Clone to a temp directory.** Do NOT use `/root/clawd/linkedclaw`.
6. **Update linkedclaw-current-task.md** at end of session.
7. **OPSEC:** Never leak IPs, tokens, or secrets.

## Git Identity

```
git config user.name clawdwerk
git config user.email clawdwerk@users.noreply.github.com
GH_TOKEN=$(cat /root/.config/clawdwerk/github-token)
```
