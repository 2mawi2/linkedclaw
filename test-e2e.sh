#!/usr/bin/env bash
# End-to-end test: two agents connect, match, negotiate, and approve a deal
set -euo pipefail

BASE="http://localhost:3000/api"
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

echo "=== LinkedClaw E2E Test ==="
echo ""

# --- 1. Register an offering profile (freelancer) ---
echo "1. Connect: offering profile"
F_RES=$(curl -sf -X POST "$BASE/connect" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-alice",
  "side": "offering",
  "category": "frontend-dev",
  "params": {
    "skills": ["react", "typescript", "node"],
    "rate_min": 50,
    "rate_max": 70,
    "currency": "EUR",
    "remote": "remote"
  },
  "description": "Senior React dev, 5 years experience"
}')
F_ID=$(echo "$F_RES" | json "print(d['profile_id'])")
[ -n "$F_ID" ] && ok "offering profile created: $F_ID" || fail "offering profile not created"

# --- 2. Register a seeking profile (client) ---
echo "2. Connect: seeking profile"
C_RES=$(curl -sf -X POST "$BASE/connect" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-bob",
  "side": "seeking",
  "category": "frontend-dev",
  "params": {
    "skills": ["react", "typescript"],
    "rate_min": 40,
    "rate_max": 60,
    "currency": "EUR",
    "remote": "remote"
  },
  "description": "E-commerce rebuild, need React frontend dev"
}')
C_ID=$(echo "$C_RES" | json "print(d['profile_id'])")
[ -n "$C_ID" ] && ok "seeking profile created: $C_ID" || fail "seeking profile not created"

# --- 3. Find matches for the offering profile ---
echo "3. Find matches"
MATCHES=$(curl -sf "$BASE/matches/$F_ID")
MATCH_COUNT=$(echo "$MATCHES" | json "print(len(d['matches']))")
MATCH_ID=$(echo "$MATCHES" | json "print(d['matches'][0]['match_id'])")
[ "$MATCH_COUNT" -ge 1 ] && ok "found $MATCH_COUNT match(es), first: $MATCH_ID" || fail "no matches found"

# --- 4. Verify match score and overlap ---
echo "4. Check overlap details"
SCORE=$(echo "$MATCHES" | json "print(d['matches'][0]['overlap']['score'])")
SKILLS=$(echo "$MATCHES" | json "print(','.join(d['matches'][0]['overlap']['matching_skills']))")
echo "   score=$SCORE, matching_skills=$SKILLS"
[ "$SCORE" -gt 0 ] && ok "match has positive score" || fail "score is zero"

# --- 5. Get deal detail ---
echo "5. Get deal detail"
DEAL=$(curl -sf "$BASE/deals/$MATCH_ID")
DEAL_STATUS=$(echo "$DEAL" | json "print(d['match']['status'])")
[ "$DEAL_STATUS" = "matched" ] && ok "deal status is 'matched'" || fail "expected 'matched', got '$DEAL_STATUS'"

# --- 6. Send a negotiation message ---
echo "6. Negotiate: alice sends message"
MSG1=$(curl -sf -X POST "$BASE/deals/$MATCH_ID/messages" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-alice",
  "content": "Hi! I saw we matched. I can start March 1st at 65 EUR/h for 30h/week.",
  "message_type": "negotiation"
}')
MSG1_STATUS=$(echo "$MSG1" | json "print(d['status'])")
[ "$MSG1_STATUS" = "negotiating" ] && ok "deal moved to 'negotiating'" || fail "expected 'negotiating', got '$MSG1_STATUS'"

# --- 7. Counter-proposal from bob ---
echo "7. Negotiate: bob sends counter-proposal"
MSG2=$(curl -sf -X POST "$BASE/deals/$MATCH_ID/messages" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-bob",
  "content": "Looks good! How about 55 EUR/h, 25h/week, starting March 15?",
  "message_type": "proposal",
  "proposed_terms": {
    "rate": 55,
    "hours_per_week": 25,
    "start_date": "2025-03-15",
    "duration_weeks": 12
  }
}')
MSG2_STATUS=$(echo "$MSG2" | json "print(d['status'])")
[ "$MSG2_STATUS" = "proposed" ] && ok "deal moved to 'proposed'" || fail "expected 'proposed', got '$MSG2_STATUS'"

# --- 8. Check deal messages ---
echo "8. Verify messages in deal"
DETAIL=$(curl -sf "$BASE/deals/$MATCH_ID")
MSG_COUNT=$(echo "$DETAIL" | json "print(len(d['messages']))")
[ "$MSG_COUNT" -eq 2 ] && ok "2 messages recorded" || fail "expected 2 messages, got $MSG_COUNT"

# --- 9. Alice approves ---
echo "9. Alice approves"
APP1=$(curl -sf -X POST "$BASE/deals/$MATCH_ID/approve" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-alice",
  "approved": true
}')
APP1_STATUS=$(echo "$APP1" | json "print(d['status'])")
[ "$APP1_STATUS" = "waiting" ] && ok "alice approved, waiting for bob" || fail "expected 'waiting', got '$APP1_STATUS'"

# --- 10. Bob approves ---
echo "10. Bob approves"
APP2=$(curl -sf -X POST "$BASE/deals/$MATCH_ID/approve" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-bob",
  "approved": true
}')
APP2_STATUS=$(echo "$APP2" | json "print(d['status'])")
[ "$APP2_STATUS" = "approved" ] && ok "deal approved by both parties!" || fail "expected 'approved', got '$APP2_STATUS'"

# --- 11. List deals for alice ---
echo "11. List agent deals"
DEALS=$(curl -sf "$BASE/deals?agent_id=agent-alice")
DEAL_COUNT=$(echo "$DEALS" | json "print(len(d['deals']))")
[ "$DEAL_COUNT" -ge 1 ] && ok "agent-alice has $DEAL_COUNT deal(s)" || fail "no deals found"

# --- 12. Verify final deal status ---
echo "12. Final deal status"
FINAL=$(curl -sf "$BASE/deals/$MATCH_ID")
FINAL_STATUS=$(echo "$FINAL" | json "print(d['match']['status'])")
APP_COUNT=$(echo "$FINAL" | json "print(len(d['approvals']))")
[ "$FINAL_STATUS" = "approved" ] && ok "final status: approved" || fail "expected 'approved', got '$FINAL_STATUS'"
[ "$APP_COUNT" -eq 2 ] && ok "$APP_COUNT approvals recorded" || fail "expected 2 approvals, got $APP_COUNT"

# --- 13. Deactivate profiles ---
echo "13. Cleanup: deactivate profiles"
DEL=$(curl -sf -X DELETE "$BASE/connect?agent_id=agent-alice")
DEL_COUNT=$(echo "$DEL" | json "print(d['deactivated_count'])")
[ "$DEL_COUNT" -ge 1 ] && ok "deactivated $DEL_COUNT profile(s) for agent-alice" || fail "deactivation failed"

# --- 14. Re-register replaces old profile ---
echo "14. Re-register (replace) test"
R1=$(curl -sf -X POST "$BASE/connect" -H "Content-Type: application/json" -d '{
  "agent_id": "agent-bob",
  "side": "seeking",
  "category": "frontend-dev",
  "params": { "skills": ["vue"] },
  "description": "Changed my mind, want Vue"
}')
REPLACED=$(echo "$R1" | json "print(d.get('replaced_profile_id', 'none'))")
[ "$REPLACED" != "none" ] && ok "old profile replaced: $REPLACED" || fail "expected replacement"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && echo "All tests passed! 🎉" || { echo "Some tests failed."; exit 1; }
