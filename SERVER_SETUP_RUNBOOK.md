# Server Recovery & Full Setup Runbook

This document serves as a step-by-step guide to completely restore or set up the AI Power Salon server from scratch in case of a disaster (e.g., the server is accidentally destroyed).

---

## Phase 1: Prerequisites & Initial Server Configuration

### 1. Launch a New EC2 Instance
- **OS:** Amazon Linux 2023 (or Ubuntu)
- **Instance Type:** Minimum `t3.small` or `t2.medium` (due to multiple PM2 instances and Docker DB).
- **Security Group Ports to Open (Inbound):**
  - `22` (SSH)
  - `80` (HTTP) & `443` (HTTPS)
  - `3000`, `8081`, `8082`, `8083`, `8084`, `8085` (Custom TCP for Web Apps)
  - `5432` (PostgreSQL - optional, restrict to local/IP if possible)

### 2. Update DNS (Domain Name)
- Update your domain (e.g., `app.aipowersalon.com`) in your DNS provider (Route53/GoDaddy) to point to the **new EC2 Public IP address**.

---

## Phase 2: Install Required Software (SSH into EC2)

Connect to your new server:
```bash
ssh -i /path/to/key.pem ec2-user@<NEW_IP_ADDRESS>
```

### 1. Install Node.js (via NVM)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm alias default 20
```

### 2. Install PM2 (Process Manager)
```bash
npm install -g pm2
pm2 startup
```

### 3. Install Docker (For Database)
```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
```
*(Log out and log back in for docker permissions to apply)*

### 4. Install Nginx & Certbot (For HTTPS)
```bash
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Phase 3: Push Codebase from Local Machine

On your **local Mac/Computer**, run a full build and sync the code to the new server.

### 1. Build Everything Locally
```bash
npm run build:api
sh scripts/build-frontends.sh
```

### 2. Rsync to the New Server
*(Replace `<NEW_IP_ADDRESS>` and key path appropriately)*
```bash
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.DS_Store' --exclude 'android' --exclude 'ios' -e "ssh -o StrictHostKeyChecking=no -i /path/to/key.pem" /path/to/local/project/ ec2-user@<NEW_IP_ADDRESS>:/home/ec2-user/ai-power-salon/
```

---

## Phase 4: Database Setup

SSH back into the server and navigate to the project:
```bash
cd /home/ec2-user/ai-power-salon
```

### 1. Create the Environment File
Create the `.env` file (you should have this backed up securely):
```bash
nano .env
```
Ensure it contains the correct database URL and ports:
```env
PORT=3001
DATABASE_URL=postgresql://aps:aps@127.0.0.1:5432/aps
JWT_SECRET=your_secret_here
# ... other required secrets ...
```

### 2. Start the Database (Docker)
```bash
docker compose up -d db
```

### 3. Install Dependencies & Migrate Database
```bash
npm install
npm run db:migrate
npm run db:seed  # Only run seed if this is a COMPLETELY fresh database with no existing data
```

---

## Phase 5: Nginx SSL & Proxy Setup

### 1. Generate SSL Certificate
Run Certbot to fetch the SSL for your domain:
```bash
sudo certbot --nginx -d app.aipowersalon.com --non-interactive --agree-tos -m contact@aipowersalon.com
```

### 2. Create the Proxy Configuration
Replace the default Nginx config:
```bash
sudo nano /etc/nginx/conf.d/aipowersalon.conf
```
Paste the following (ensure the paths match your certbot paths):
```nginx
server {
    if ($host = app.aipowersalon.com) { return 301 https://$host$request_uri; }
    listen 80;
    server_name app.aipowersalon.com;
    return 404;
}

# Backend API
server {
    listen 3000 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:3001; }
}

# Admin Web
server {
    listen 8081 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:9081; }
}

# POS Web
server {
    listen 8082 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:9082; }
}

# Tech Web
server {
    listen 8083 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:9083; }
}

# Owner Web
server {
    listen 8084 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:9084; }
}

# Customer Web
server {
    listen 8085 ssl;
    server_name app.aipowersalon.com;
    ssl_certificate /etc/letsencrypt/live/app.aipowersalon.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.aipowersalon.com/privkey.pem;
    
    location / { proxy_pass http://127.0.0.1:9085; }
}
```

Restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## Phase 6: Start All Applications (PM2)

Finally, launch the backend and all frontend static servers using PM2 on their respective internal ports:

```bash
cd /home/ec2-user/ai-power-salon

# Start Backend (Listens on 3001 as per .env)
pm2 start npm --name ai-power-salon -- run dev:backend

# Start Frontends (Internal Ports 9081-9085)
pm2 serve dist-frontends/admin-web 9081 --name admin-web --spa
pm2 serve dist-frontends/pos-web 9082 --name pos-web --spa
pm2 serve dist-frontends/tech-web 9083 --name tech-web --spa
pm2 serve dist-frontends/owner-web 9084 --name owner-web --spa
pm2 serve dist-frontends/customer-web 9085 --name customer-web --spa

# Save state so it restarts on server reboot
pm2 save
```

### Verification
Visit `https://app.aipowersalon.com:8083` in your browser. It should load securely with a green SSL padlock!

---

## Phase 7: Useful Server Maintenance Commands

### PM2 Commands (App Management)
- **Check Status & List Apps:** `pm2 list`
- **Restart All Apps:** `pm2 restart all`
- **Restart Specific App:** `pm2 restart tech-web` (replace name)
- **View Real-time Logs:** `pm2 logs`
- **View Logs for One App:** `pm2 logs ai-power-salon`
- **Stop All Apps:** `pm2 stop all`
- **Monitor CPU/Memory (Dashboard):` `pm2 monit`

### Nginx Commands (Web Server)
- **Check Nginx Config Syntax:** `sudo nginx -t`
- **Restart Nginx:** `sudo systemctl restart nginx`
- **Check Nginx Status:** `sudo systemctl status nginx`

### SSL (Certbot) Commands
- **Check Certificate Expiry:** `sudo certbot certificates`
- **Test Auto-Renewal:** `sudo certbot renew --dry-run`
