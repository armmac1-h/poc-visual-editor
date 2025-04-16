#!/bin/bash

# Exit on error
set -e

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Visual Editor PoC Services...${NC}"

# Start Preview (React + Vite)
echo -e "${YELLOW}Starting Preview service...${NC}"
cd poc-preview
npm run dev &
PREVIEW_PID=$!
echo "Preview service started with PID: $PREVIEW_PID"

# Wait a bit to ensure preview is up
sleep 2

# Start Backend (Node.js)
echo -e "${YELLOW}Starting Backend service...${NC}"
cd ../poc-backend
npm run dev &
BACKEND_PID=$!
echo "Backend service started with PID: $BACKEND_PID"

# Start Frontend (Static server)
echo -e "${YELLOW}Starting Frontend service...${NC}"
cd ../poc-frontend
npx serve &
FRONTEND_PID=$!
echo "Frontend service started with PID: $FRONTEND_PID"

echo -e "${GREEN}All services started!${NC}"
echo -e "${GREEN}Open http://localhost:3000 in your browser${NC}"

# Handle graceful shutdown
function cleanup {
  echo -e "${YELLOW}Shutting down all services...${NC}"
  kill $PREVIEW_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
}

trap cleanup EXIT

# Keep the script running
echo "Press Ctrl+C to stop all services..."
wait 