#!/bin/bash
# Deployment script for PowerTrader
# Run this after oracle-setup.sh and re-logging in

set -e

PROJECT_DIR="$HOME/powertrader"
REPO_URL="${1:-git@github.com:YOUR_USERNAME/Crypto_Trading_PowerTrade.git}"

echo "=== Cloning/Updating Repository ==="
if [ -d "$PROJECT_DIR" ]; then
    echo "Project exists, pulling latest..."
    cd "$PROJECT_DIR"
    git pull
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

echo "=== Setting up API credentials ==="
# Check if credentials exist
if [ ! -f "$PROJECT_DIR/kraken_key.txt" ]; then
    echo ""
    echo "⚠️  API credentials not found!"
    echo "Please create these files:"
    echo "  $PROJECT_DIR/kraken_key.txt"
    echo "  $PROJECT_DIR/kraken_secret.txt"
    echo ""
    echo "You can do this with:"
    echo "  echo 'YOUR_API_KEY' > $PROJECT_DIR/kraken_key.txt"
    echo "  echo 'YOUR_API_SECRET' > $PROJECT_DIR/kraken_secret.txt"
    echo ""
fi

echo "=== Creating data directories ==="
mkdir -p "$PROJECT_DIR/data/runtime"
mkdir -p "$PROJECT_DIR/data/training"

echo "=== Building and Starting Containers ==="
cd "$PROJECT_DIR/pt_hub_web"

# Build for ARM architecture (Oracle Free Tier uses ARM)
docker compose build

# Start services
docker compose up -d backend frontend

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Services running:"
docker compose ps
echo ""
echo "Access your app at:"
echo "  Frontend: http://$(curl -s ifconfig.me):3000"
echo "  Backend API: http://$(curl -s ifconfig.me):8000"
echo "  API Docs: http://$(curl -s ifconfig.me):8000/docs"
echo ""
echo "Useful commands:"
echo "  View logs:     cd $PROJECT_DIR/pt_hub_web && docker compose logs -f"
echo "  Restart:       cd $PROJECT_DIR/pt_hub_web && docker compose restart"
echo "  Stop:          cd $PROJECT_DIR/pt_hub_web && docker compose down"
echo "  Update:        cd $PROJECT_DIR && git pull && cd pt_hub_web && docker compose up -d --build"
