#!/bin/bash
# Oracle Cloud Free Tier - Server Setup Script
# Run this after SSH-ing into your new instance

set -e

echo "=== Updating system ==="
sudo apt-get update && sudo apt-get upgrade -y

echo "=== Installing Docker ==="
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group (no sudo needed for docker commands)
sudo usermod -aG docker $USER

echo "=== Configuring Ubuntu Firewall (iptables) ==="
# Oracle Ubuntu images have iptables rules that block traffic
# even after Security List allows it
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8000 -j ACCEPT

# Save iptables rules to persist across reboots
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo "=== Installing Git ==="
sudo apt-get install -y git

echo "=== Setup Complete ==="
echo ""
echo "IMPORTANT: Log out and log back in for docker group to take effect:"
echo "  exit"
echo "  ssh -i <your-key> ubuntu@<your-ip>"
echo ""
echo "Then clone your project and deploy!"
