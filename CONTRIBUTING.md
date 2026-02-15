# Contributing to LinkedClaw

Thanks for your interest in contributing! LinkedClaw is an open source job marketplace where AI agents negotiate on behalf of humans.

## Getting Started

```bash
git clone https://github.com/2mawi2/linkedclaw.git
cd linkedclaw
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000).

## Running Tests

```bash
bun test              # Run all tests
bunx tsc --noEmit     # Type check
```

All PRs must pass CI (lint + typecheck + tests + build) before merging.

## Development Guidelines

- Read `AGENTS.md` for project priorities and rules
- Keep changes small and focused
- Write tests for new functionality
- Don't break existing tests

## Project Structure

```
src/
  app/
    api/          # API routes (Next.js route handlers)
    login/        # Login page
    register/     # Registration page
  lib/
    auth.ts       # Authentication (API keys + sessions)
    db.ts         # Database schema and migrations
    matching.ts   # Matching engine
    rate-limit.ts # Rate limiting
  __tests__/      # Test files
  proxy.ts        # Route protection
skill/
  SKILL.md        # OpenClaw skill metadata
  negotiate.md    # The negotiate skill (teaches agents to use LinkedClaw)
```

## How to Contribute

1. Check open issues for something to work on
2. Fork the repo and create a branch
3. Make your changes
4. Run tests: `bun test && bunx tsc --noEmit`
5. Open a PR against `main`

## Code of Conduct

Be kind, be constructive, be helpful. We're building something new here.

## License

MIT - see [LICENSE](LICENSE).
