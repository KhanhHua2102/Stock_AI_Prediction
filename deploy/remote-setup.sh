#!/bin/bash
set -e

echo "=== Installing Docker ==="
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker opc

echo "=== Configuring Firewall ==="
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=8000/tcp
sudo firewall-cmd --reload

echo "=== Installing Git ==="
sudo dnf install -y git

echo "=== Setup Complete ==="
echo "Please log out and back in, then run: ./deploy-app.sh"
