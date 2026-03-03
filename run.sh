#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
cleanup() { echo -e "\n${RED}Shutting down...${NC}"; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0; }
trap cleanup SIGINT SIGTERM
[ ! -d "venv" ] && python3 -m venv venv && source venv/bin/activate && pip install -r pt_hub_web/backend/requirements.txt yfinance vnstock || source venv/bin/activate
[ ! -d "pt_hub_web/frontend/node_modules" ] && (cd pt_hub_web/frontend && npm install)
echo -e "${GREEN}Starting Backend :8000...${NC}"
(cd pt_hub_web/backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!
sleep 2
echo -e "${GREEN}Starting Frontend :8081...${NC}"
(cd pt_hub_web/frontend && npx vite --port 8081) &
FRONTEND_PID=$!
echo -e "\n${GREEN}Stock AI Prediction Hub running!${NC}"
echo -e "${GREEN}  Frontend: http://localhost:8081${NC}"
echo -e "${GREEN}  Backend:  http://localhost:8000${NC}"
echo -e "Press Ctrl+C to stop\n"
wait
