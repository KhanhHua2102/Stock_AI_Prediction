# Oracle Cloud Free Tier Deployment Guide

## Quick Reference

### What You Get (Free Forever)
- 4 ARM CPU cores (Ampere A1)
- 24 GB RAM
- 200 GB block storage
- 10 TB/month outbound data

### Step-by-Step Summary

#### 1. Create Oracle Account
- Go to [cloud.oracle.com](https://cloud.oracle.com)
- Sign up with credit card (verification only, not charged)

#### 2. Create ARM VM Instance
- Compute → Instances → Create Instance
- Shape: **VM.Standard.A1.Flex** (Ampere ARM)
- OCPUs: 2, Memory: 12GB
- Image: Ubuntu 22.04
- Download SSH keys

#### 3. Open Firewall Ports
- Networking → Virtual Cloud Networks → Your VCN → Subnet → Security List
- Add Ingress Rules for ports: 80, 443, 3000, 8000

#### 4. SSH and Setup Server
```bash
# Connect
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<YOUR_IP>

# Download and run setup script
curl -O https://raw.githubusercontent.com/YOUR_USER/Crypto_Trading_PowerTrade/main/deploy/oracle-setup.sh
chmod +x oracle-setup.sh
./oracle-setup.sh

# IMPORTANT: Log out and back in
exit
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<YOUR_IP>
```

#### 5. Deploy Application
```bash
# Clone your repo (use HTTPS if SSH not set up)
git clone https://github.com/YOUR_USER/Crypto_Trading_PowerTrade.git ~/powertrader

# Set up API credentials
echo 'YOUR_KRAKEN_KEY' > ~/powertrader/kraken_key.txt
echo 'YOUR_KRAKEN_SECRET' > ~/powertrader/kraken_secret.txt

# Create directories
mkdir -p ~/powertrader/data/runtime ~/powertrader/data/training

# Build and run
cd ~/powertrader/pt_hub_web
docker compose up -d backend frontend
```

#### 6. Verify Deployment
```bash
# Check containers are running
docker compose ps

# View logs
docker compose logs -f

# Test endpoints
curl http://localhost:8000/api/health
```

## Access Your App
- **Frontend**: `http://<YOUR_IP>:3000`
- **Backend API**: `http://<YOUR_IP>:8000`
- **API Docs**: `http://<YOUR_IP>:8000/docs`

## Common Commands

```bash
# View live logs
cd ~/powertrader/pt_hub_web && docker compose logs -f

# Restart services
docker compose restart

# Stop everything
docker compose down

# Update and redeploy
cd ~/powertrader && git pull
cd pt_hub_web && docker compose up -d --build

# Check resource usage
docker stats
```

---

## My Server Setup (Oracle Linux x86)

### Step 1: SSH into your server

```bash
ssh -i <REDACTED_KEY_FILE> opc@<REDACTED_IP>
```

### Step 2: Install Docker

```bash
sudo dnf install -y dnf-utils && \
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo && \
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && \
sudo systemctl start docker && \
sudo systemctl enable docker && \
sudo usermod -aG docker opc
```

### Step 3: Configure firewall

```bash
sudo firewall-cmd --permanent --add-port=80/tcp && \
sudo firewall-cmd --permanent --add-port=443/tcp && \
sudo firewall-cmd --permanent --add-port=3000/tcp && \
sudo firewall-cmd --permanent --add-port=8000/tcp && \
sudo firewall-cmd --reload
```

### Step 4: Log out and back in (required for docker group)

```bash
exit
ssh -i <REDACTED_KEY_FILE> opc@<REDACTED_IP>
```

### Step 5: Clone and deploy

```bash
git clone https://github.com/YOUR_USERNAME/Crypto_Trading_PowerTrade.git ~/powertrader && \
cd ~/powertrader/pt_hub_web && \
docker compose up -d backend frontend
```

---

## Troubleshooting

### Can't connect to ports?
1. Check Oracle Security List has ingress rules
2. Check Ubuntu iptables: `sudo iptables -L -n`
3. Verify containers are running: `docker compose ps`

### Docker permission denied?
Log out and back in after running setup script (adds user to docker group)

### ARM build issues?
Your Dockerfiles use `python:3.11-slim` and `node:20-alpine` which both support ARM64 natively.

## Security Recommendations

1. **Use HTTPS**: Set up nginx with Let's Encrypt for production
2. **Restrict API access**: Consider only exposing port 80/443
3. **Keep credentials safe**: Never commit `kraken_key.txt` or `kraken_secret.txt`

## Optional: Set Up Domain + HTTPS

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate (replace with your domain)
sudo certbot --nginx -d yourdomain.com
```
