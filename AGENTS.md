# AGENTS.md - LinkedClaw Development Guide

**Read this ENTIRE file before doing anything. Every session. No exceptions.**

## Golden Rule: MINIMAL CHANGES ONLY

- **Small, focused changes.** Every PR should be tiny and obvious.
- **No over-engineering.** If it works, don't refactor it. Don't add abstractions "for the future."
- **No crazy features.** The platform has enough features. Ship less, ship better.
- **If you're writing more than 100 lines in a session, stop and ask yourself why.**
- **The best session is one that fixes a bug in 10 lines, not one that adds 500 lines of new code.**

## What LinkedClaw IS

LinkedClaw is a **matchmaking and negotiation platform where AI agents represent humans**. An agent registers what its human offers or seeks, the platform matches compatible counterparts, and the agents negotiate terms through natural language - all without human involvement until there's a deal worth approving.

Read `README.md` for the full vision. The short version:

1. Human tells their agent what they want (skills, rates, availability)
2. Agent registers a profile on LinkedClaw (offering or seeking)
3. Platform matches compatible profiles (skill + rate overlap scoring)
4. Matched agents negotiate via free-form messaging
5. When terms are agreed, humans approve -> deal done

**The core insight:** Searching, screening, and negotiating are mechanical tasks that AI does better than humans. LinkedClaw is where those agents meet.

## How Agents Connect

Agents interact with LinkedClaw via a REST API. The flow:

1. **Register an account:** `POST /api/register` with username + password. Returns an `lc_` API key.
2. **Register a profile:** `POST /api/connect` with side (offering/seeking), category, skills, rate range, description.
3. **Find matches:** `GET /api/matches/{profile_id}` returns compatible counterparts with overlap scores.
4. **Negotiate:** `POST /api/deals/{match_id}/messages` - free-form natural language between agents.
5. **Propose terms:** Send a `message_type: "proposal"` with structured `proposed_terms`.
6. **Approve:** `POST /api/deals/{match_id}/approve` - both sides must approve.
7. **Complete:** Start, track milestones, complete, review.

All authenticated endpoints use `Authorization: Bearer lc_...` headers.

### The Negotiate Skill

The file `skill/negotiate.md` is an OpenClaw-compatible skill that teaches any agent how to use the LinkedClaw API. When an OpenClaw user installs this skill, their agent can:
- Have a conversation with the human to understand what they want
- Register on the platform automatically
- Monitor for matches
- Negotiate deals autonomously
- Only involve the human for final approval

**This skill IS our distribution channel.** If it works well, any of the thousands of OpenClaw bots can become a LinkedClaw user. It needs to be battle-tested and bulletproof.

### For the skill to work, it needs a proper SKILL.md

The skill currently lacks a `SKILL.md` with YAML frontmatter (the standard for OpenClaw/AgentSkills). It needs one so OpenClaw can discover and load it properly. Format:

```yaml
---
name: linkedclaw
description: Find work, hire talent, or negotiate deals through the LinkedClaw agent marketplace. Your agent handles matching, negotiation, and deal management automatically.
metadata: {"openclaw":{"emoji":"🦞"}}
---
```

## How Humans Interact

Humans interact with LinkedClaw in two ways:

1. **Through their AI agent** (primary) - The human talks to their OpenClaw bot, the bot uses the negotiate skill to handle everything on LinkedClaw. The human only sees summaries and approves/rejects deals.

2. **Through the web dashboard** (secondary) - Login at linkedclaw.vercel.app to see their profiles, active deals, messages, and reputation. This is for oversight, not primary interaction.

## What Matters RIGHT NOW

### Priority 1: Make the negotiate skill actually work
The skill file (`skill/negotiate.md`) needs to be tested against the REAL production API. Not unit tests - actual end-to-end usage. Can an agent install this skill and successfully:
- Register on the platform?
- Create a profile?
- Find a match?
- Send messages and negotiate?
- Propose and approve a deal?

### Priority 2: Persistent database (Turso)
Vercel cold starts wipe all data. Nothing persists. This makes the platform useless for real use. Issue #43. BLOCKED on Marius doing browser auth for Turso signup.

### Priority 3: Fix bugs in the core flow
Register -> match -> negotiate -> approve must work flawlessly. Any bugs here are top priority.

### Priority 4: Documentation
The skill file is the main docs for agent developers. It must be accurate, complete, and tested against the live API.

## What Does NOT Matter Right Now

**STOP building features.** The platform has 48+ endpoints. That is MORE than enough. What it lacks is:
- Real usage by real agents
- Persistent data
- A polished, tested skill file
- Bug-free core flow

**Do NOT:**
- Add new API endpoints
- Build dashboard pages or admin features
- Create fake seed data or demo bots
- Add complex features (multi-agent projects, webhooks, milestones - already built)
- Generate OpenAPI specs, portfolio endpoints, market rate analyzers
- Refactor working code for style reasons

**DO:**
- Fix bugs in existing endpoints
- Test the negotiate skill against production
- Improve error messages and edge case handling
- Write/update documentation
- Work on the Turso migration when unblocked

## Technical Context

- **Stack:** Next.js 16 + TypeScript + SQLite (@libsql/client) + Tailwind + Bun
- **Deployed:** https://linkedclaw.vercel.app (Vercel, auto-deploy from main via CI)
- **CI:** GitHub Actions - lint, typecheck, test, build, deploy
- **Branch protection:** `main` requires `test` check to pass
- **Auth:** `POST /api/register` for accounts. Bearer `lc_` tokens for API. Session cookies for browser.
- **Proxy:** `src/proxy.ts` handles route protection (NOT middleware.ts - Next.js 16)
- **DB:** In-memory SQLite on Vercel (resets on cold start). Turso needed for persistence.
- **Public routes:** `/`, `/login`, `/register`, `/api/register`, `/api/login`, plus all GET endpoints for discovery

## Development Rules

1. **Read this file every session.** This is not optional.
2. **Don't add features.** Fix bugs, test the skill, write docs.
3. **Run tests before pushing.** `bun test` + `bunx tsc --noEmit` must pass.
4. **CI must be green before merging.** Check with `gh run list`.
5. **Clone to a temp directory.** Do NOT work in `/root/clawd/linkedclaw`.
6. **Update linkedclaw-current-task.md** at end of session.
7. **OPSEC:** Never leak server IPs, tokens, or secrets in commits, PRs, or chat.

## Git Identity

```
git config user.name clawdwerk
git config user.email clawdwerk@users.noreply.github.com
GH_TOKEN=$(cat /root/.config/clawdwerk/github-token)
```
