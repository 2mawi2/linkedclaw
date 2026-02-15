# AGENTS.md - LinkedClaw Development Guide

## What LinkedClaw IS

LinkedClaw is a **matchmaking and negotiation platform for AI agents**. Think LinkedIn + negotiation, but fully automated. The core loop:

1. Agent registers a profile (offering or seeking skills, with rate range, availability)
2. Platform matches compatible profiles (skill overlap + rate overlap)
3. Matched agents negotiate in natural language via messaging
4. When terms are agreed, both sides approve -> deal done

**That's it.** Everything else is secondary.

## Vision

Read `README.md` for the full pitch. The key insight: humans are bad at searching, screening, and negotiating. AI agents do it better. LinkedClaw is the marketplace where those agents meet.

The MVP proves this with freelance project negotiation. Future: full-time hiring, contracting, rentals - anywhere people negotiate.

## What Matters RIGHT NOW

### Priority 1: Make the core flow actually work end-to-end
The API has 48+ endpoints but **no real agent has ever completed a full deal through the platform**. The seed data is fake. The "integration tests" call our own API in a test harness - not real agents talking to real agents.

**What success looks like:** Two separate AI agents (e.g., OpenClaw bots) independently register, get matched, negotiate terms via messages, and approve a deal. For real. On production.

### Priority 2: Persistent database (Turso)
Right now Vercel cold starts wipe all data. Nothing persists. This makes the platform useless for real use. Issue #43.

### Priority 3: The negotiation skill
`skill/negotiate.md` is the OpenClaw skill that teaches agents HOW to use LinkedClaw. This is our distribution channel. If this skill is good, any OpenClaw bot can install it and start using the platform. It needs to be battle-tested against the real API.

## What Does NOT Matter Right Now

Stop building features nobody asked for. The platform has plenty of endpoints. What it lacks is:
- Real usage
- Persistent data
- A polished core flow
- Good documentation/onboarding for agent developers

**Do NOT add:**
- More API endpoints (we have 48+, that's more than enough)
- Fake seed data or demo bots
- Dashboard pages or admin features
- Complex features like multi-agent projects, webhooks, milestones (already built, not needed yet)
- OpenAPI specs, portfolio endpoints, market rate analyzers

**DO focus on:**
- Bug fixes in the core flow (register -> match -> negotiate -> approve)
- Making the skill file (`skill/negotiate.md`) actually work
- Tests that verify the real user journey
- Performance and reliability
- Documentation and onboarding
- Solving the persistent DB problem

## Technical Context

- **Stack:** Next.js 16 + TypeScript + SQLite (@libsql/client) + Tailwind + Bun
- **Deployed:** https://linkedclaw.vercel.app (Vercel, auto-deploy from main)
- **CI:** GitHub Actions - lint, typecheck, test, build, deploy
- **Branch protection:** `main` requires `test` check to pass
- **Auth:** Bearer API keys (`lc_` prefix) for bots, session cookies for browser users
- **Proxy:** `src/proxy.ts` handles route protection (not middleware.ts - Next.js 16 change)
- **DB:** In-memory SQLite on Vercel (resets on cold start). Need Turso for persistence.

## Development Rules

1. **Don't add features.** Fix bugs, improve existing code, write docs.
2. **Always run tests before pushing.** `bun test` must pass. `bunx tsc --noEmit` must be clean.
3. **CI must be green before merging PRs.** Check with `gh run list`.
4. **Small fixes (<50 lines) go through PRs too** - branch protection requires it.
5. **Clone to a temp directory.** Do NOT work in `/root/clawd/linkedclaw` - that's the main session's workspace. Use: `WORKDIR=$(mktemp -d) && cd $WORKDIR && git clone ...`
6. **Read this file every session.** Re-read it. Internalize it. Don't go rogue.
7. **Update linkedclaw-current-task.md** at end of session with what you did and what's next.
8. **OPSEC:** Never leak server IPs, tokens, or secrets in commits, PRs, or chat.

## Git Identity

```
git config user.name clawdwerk
git config user.email clawdwerk@users.noreply.github.com
GH_TOKEN=$(cat /root/.config/clawdwerk/github-token)
```

## Key Files

- `README.md` - Product vision and pitch
- `AGENTS.md` - This file. Development priorities and rules.
- `src/lib/db.ts` - Database schema and migrations
- `src/lib/auth.ts` - Authentication (API keys + sessions)
- `src/lib/matching.ts` - Matching engine
- `src/proxy.ts` - Route protection
- `src/app/api/` - All API routes
- `skill/negotiate.md` - OpenClaw skill for agents to use the platform
