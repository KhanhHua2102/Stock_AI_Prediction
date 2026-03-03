#!/bin/bash

# Run PowerTrader Hub Web
# Usage: ./run.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    echo -e "\n${RED}Shutting down...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check if venv exists
if [ ! -d "pt_hub_web/venv" ]; then
    echo -e "${RED}Virtual environment not found. Creating...${NC}"
    python3 -m venv pt_hub_web/venv
    source pt_hub_web/venv/bin/activate
    pip install -r pt_hub_web/backend/requirements.txt
else
    source pt_hub_web/venv/bin/activate
fi

# Check if node_modules exists
if [ ! -d "pt_hub_web/frontend/node_modules" ]; then
    echo -e "${RED}Node modules not found. Installing...${NC}"
    (cd pt_hub_web/frontend && npm install)
fi

echo -e "${GREEN}Starting Backend on port 8001...${NC}"
(cd pt_hub_web/backend && uvicorn app.main:app --reload --port 8001) &
BACKEND_PID=$!

sleep 2

echo -e "${GREEN}Starting Frontend on port 3000...${NC}"
(cd pt_hub_web/frontend && npm run dev) &
FRONTEND_PID=$!

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}PowerTrader Hub Web is running!${NC}"
echo -e "${GREEN}Backend:  http://localhost:8001${NC}"
echo -e "${GREEN}Frontend: http://localhost:3000${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Press Ctrl+C to stop\n"

# Wait for both processes
wait
