#!/usr/bin/env bash
# End-to-end test: two agents register, match, negotiate, and approve
set -euo pipefail

BASE="http://localhost:3000/api"

echo "=== 1. Register freelancer ==="
F_REG=$(curl -s -X POST "$BASE/register" -H "Content-Type: application/json" -d '{
  "role": "freelancer",
  "agent_id": "freelancer-alice",
  "skills": ["react", "typescript", "node"],
  "rate_min": 50,
  "rate_max": 70,
  "currency": "EUR",
  "availability_start": "2025-03-01",
  "hours_min": 20,
  "hours_max": 40,
  "duration_min_weeks": 4,
  "duration_max_weeks": 24,
  "remote_preference": "remote",
  "description": "Senior React dev, 5 years experience"
}')
echo "$F_REG"
F_ID=$(echo "$F_REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['registration_id'])")

echo ""
echo "=== 2. Register client ==="
C_REG=$(curl -s -X POST "$BASE/register" -H "Content-Type: application/json" -d '{
  "role": "client",
  "agent_id": "client-bob",
  "skills": ["react", "typescript"],
  "rate_min": 40,
  "rate_max": 60,
  "currency": "EUR",
  "availability_start": "2025-03-15",
  "hours_min": 20,
  "hours_max": 30,
  "duration_min_weeks": 8,
  "duration_max_weeks": 16,
  "remote_preference": "remote",
  "description": "E-commerce rebuild, need React frontend dev",
  "skills_must_have": ["react"],
  "skills_nice_to_have": ["typescript"]
}')
echo "$C_REG"
C_ID=$(echo "$C_REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['registration_id'])")

echo ""
echo "=== 3. Check matches for freelancer ==="
MATCHES=$(curl -s "$BASE/matches/$F_ID")
echo "$MATCHES" | python3 -m json.tool
MATCH_ID=$(echo "$MATCHES" | python3 -c "import sys,json; print(json.load(sys.stdin)['matches'][0]['match_id'])")

echo ""
echo "=== 4. Negotiation round 1: freelancer proposes ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID" -H "Content-Type: application/json" -d '{
  "proposer_role": "freelancer",
  "proposed_rate": 70,
  "proposed_start_date": "2025-03-01",
  "proposed_hours": 30,
  "proposed_duration_weeks": 12
}' | python3 -m json.tool

echo ""
echo "=== 5. Negotiation round 1: client proposes ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID" -H "Content-Type: application/json" -d '{
  "proposer_role": "client",
  "proposed_rate": 45,
  "proposed_start_date": "2025-03-15",
  "proposed_hours": 25,
  "proposed_duration_weeks": 12
}' | python3 -m json.tool

echo ""
echo "=== 6. Negotiation round 2: freelancer moves ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID" -H "Content-Type: application/json" -d '{
  "proposer_role": "freelancer",
  "proposed_rate": 62,
  "proposed_start_date": "2025-03-10",
  "proposed_hours": 28,
  "proposed_duration_weeks": 12
}' | python3 -m json.tool

echo ""
echo "=== 7. Negotiation round 2: client moves ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID" -H "Content-Type: application/json" -d '{
  "proposer_role": "client",
  "proposed_rate": 52,
  "proposed_start_date": "2025-03-12",
  "proposed_hours": 26,
  "proposed_duration_weeks": 12
}' | python3 -m json.tool

echo ""
echo "=== 8. Negotiation round 3: freelancer converges ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID" -H "Content-Type: application/json" -d '{
  "proposer_role": "freelancer",
  "proposed_rate": 55,
  "proposed_start_date": "2025-03-12",
  "proposed_hours": 26,
  "proposed_duration_weeks": 12
}' | python3 -m json.tool

echo ""
echo "=== 9. Check negotiation status ==="
curl -s "$BASE/negotiate/$MATCH_ID" | python3 -m json.tool

echo ""
echo "=== 10. Freelancer approves ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID/approve" -H "Content-Type: application/json" -d '{
  "agent_id": "freelancer-alice",
  "role": "freelancer",
  "approved": true
}' | python3 -m json.tool

echo ""
echo "=== 11. Client approves ==="
curl -s -X POST "$BASE/negotiate/$MATCH_ID/approve" -H "Content-Type: application/json" -d '{
  "agent_id": "client-bob",
  "role": "client",
  "approved": true
}' | python3 -m json.tool

echo ""
echo "=== 12. List negotiations for freelancer ==="
curl -s "$BASE/negotiations/freelancer-alice" | python3 -m json.tool

echo ""
echo "=== DONE ==="
