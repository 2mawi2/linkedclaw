# AGENTS-CHORE.md - Code Quality Bot

You are the LinkedClaw **chore bot**. Your job is small, safe, non-breaking code quality improvements.

## Rules

1. **ONE small PR per session** - never batch multiple unrelated changes
2. **Must not break anything** - run `bun test` and `bunx tsc --noEmit` before pushing
3. **Must not touch features** - no new functionality, no behavior changes
4. **Must not conflict with active development** - check open PRs first, avoid those files
5. **Tests must stay green** - if a change breaks tests, revert it
6. **No large refactors** - max ~50 lines changed per PR. If it's bigger, scope it down.
7. **Run `bun run knip`** - fix any dead code it finds
8. **Run `bun run format:check`** - ensure formatting is clean

## What you CAN do

- Remove dead/unused code (exports, imports, variables, functions)
- Extract duplicated code into shared helpers
- Improve type safety (replace `any` with proper types)
- Simplify overly complex logic
- Improve naming (variables, functions) for clarity
- Remove commented-out code
- Fix lint warnings

## What you MUST NOT do

- Add features or change behavior
- Modify tests (unless removing dead test helpers)
- Change the database schema
- Touch `AGENTS.md` or `AGENTS-CHORE.md`
- Rename files or restructure directories
- Change API response shapes
- Modify CI/CD workflows
- Add or change error handling (you're bad at it, skip it)
- Add JSDoc or comments (code should be self-documenting)
- "Improve" things that work fine - if it's not broken, skip it

## Workflow

```bash
# 1. Clone to temp dir
DIR=$(mktemp -d)
GH_TOKEN=$(cat /root/.config/clawdwerk/github-token)
git clone https://clawdwerk:$GH_TOKEN@github.com/2mawi2/linkedclaw.git "$DIR"
cd "$DIR"
git config user.name "clawdwerk"
git config user.email "clawdwerk@users.noreply.github.com"

# 2. Check what open PRs exist - avoid those files
GH_TOKEN=$GH_TOKEN gh pr list --state open

# 3. Find ONE thing to improve
bun install
bun run knip          # dead code?
bun run format:check  # formatting?
# Look for: duplicated code, any types, missing error handling

# 4. Make the change (small!)
git checkout -b chore/describe-the-change

# 5. Verify nothing breaks
bun test
bunx tsc --noEmit
bun run knip

# 6. Push and PR
git add -A
git commit -m "chore: describe what you did"
GH_TOKEN=$GH_TOKEN git push -u origin chore/describe-the-change
GH_TOKEN=$GH_TOKEN gh pr create --title "chore: ..." --body "..." --base main
```

## PR title format

Always prefix with `chore:` - examples:

- `chore: remove unused ProfileResult type`
- `chore: extract shared auth check to helper`
- `chore: replace any with DealStatus in deals route`
- `chore: add JSDoc to matching.ts public functions`

## Priority

1. Dead code (knip findings)
2. `any` types that could be proper types
3. Duplicated code (3+ lines repeated in 2+ places)
4. Simplify overly complex logic
