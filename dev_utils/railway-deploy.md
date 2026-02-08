OpenClaw Railway Template (1‑click deploy)
This repo packages OpenClaw for Railway with a small /setup web wizard so users can deploy and onboard without running any commands.

What you get
OpenClaw Gateway + Control UI (served at / and /openclaw)
A friendly Setup Wizard at /setup (protected by a password)
Persistent state via Railway Volume (so config/credentials/memory survive redeploys)
One-click Export backup (so users can migrate off Railway later)
Import backup from /setup (advanced recovery)
How it works (high level)
The container runs a wrapper web server.
The wrapper protects /setup with SETUP_PASSWORD.
During setup, the wrapper runs openclaw onboard --non-interactive ... inside the container, writes state to the volume, and then starts the gateway.
After setup, / is OpenClaw. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.
Railway deploy instructions (what you’ll publish as a Template)
In Railway Template Composer:

Create a new template from this GitHub repo.
Add a Volume mounted at /data.
Set the following variables:
Required:

SETUP_PASSWORD — user-provided password to access /setup
Recommended:

OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_WORKSPACE_DIR=/data/workspace
Optional:

OPENCLAW_GATEWAY_TOKEN — if not set, the wrapper generates one (not ideal). In a template, set it using a generated secret.
Notes:

This template pins OpenClaw to a known-good version by default via Docker build arg OPENCLAW_GIT_REF.
Backward compatibility: The wrapper includes a shim for CLAWDBOT_* environment variables (logs a deprecation warning when used). MOLTBOT_* variables are not shimmed — this repo never shipped with MOLTBOT prefixes, so no existing deployments rely on them.
Enable Public Networking (HTTP). Railway will assign a domain.
This service is configured to listen on port 8080 (including custom domains).
Deploy.
Then:

Visit https://<your-app>.up.railway.app/setup
Complete setup
Visit https://<your-app>.up.railway.app/ and /openclaw
Getting chat tokens (so you don’t have to scramble)
Telegram bot token
Open Telegram and message @BotFather
Run /newbot and follow the prompts
BotFather will give you a token that looks like: 123456789:AA...
Paste that token into /setup
Discord bot token
Go to the Discord Developer Portal: https://discord.com/developers/applications
New Application → pick a name
Open the Bot tab → Add Bot
Copy the Bot Token and paste it into /setup
Invite the bot to your server (OAuth2 URL Generator → scopes: bot, applications.commands; then choose permissions)
Local smoke test
docker build -t openclaw-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# open http://localhost:8080/setup (password: test)

Hosting and deployment
Deploy on Railway
Deploy OpenClaw on Railway with a one-click template and finish setup in your browser. This is the easiest “no terminal on the server” path: Railway runs the Gateway for you, and you configure everything via the /setup web wizard.
​
Quick checklist (new users)
Click Deploy on Railway (below).
Add a Volume mounted at /data.
Set the required Variables (at least SETUP_PASSWORD).
Enable HTTP Proxy on port 8080.
Open https://<your-railway-domain>/setup and finish the wizard.
​
One-click deploy
Deploy on Railway
After deploy, find your public URL in Railway → your service → Settings → Domains.
Railway will either:
give you a generated domain (often https://<something>.up.railway.app), or
use your custom domain if you attached one.
Then open:
https://<your-railway-domain>/setup — setup wizard (password protected)
https://<your-railway-domain>/openclaw — Control UI
​
What you get
Hosted OpenClaw Gateway + Control UI
Web setup wizard at /setup (no terminal commands)
Persistent storage via Railway Volume (/data) so config/credentials/workspace survive redeploys
Backup export at /setup/export to migrate off Railway later
​
Required Railway settings
​
Public Networking
Enable HTTP Proxy for the service.
Port: 8080
​
Volume (required)
Attach a volume mounted at:
/data
​
Variables
Set these variables on the service:
SETUP_PASSWORD (required)
PORT=8080 (required — must match the port in Public Networking)
OPENCLAW_STATE_DIR=/data/.openclaw (recommended)
OPENCLAW_WORKSPACE_DIR=/data/workspace (recommended)
OPENCLAW_GATEWAY_TOKEN (recommended; treat as an admin secret)
​
Setup flow
Visit https://<your-railway-domain>/setup and enter your SETUP_PASSWORD.
Choose a model/auth provider and paste your key.
(Optional) Add Telegram/Discord/Slack tokens.
Click Run setup.
If Telegram DMs are set to pairing, the setup wizard can approve the pairing code.
​
Getting chat tokens
​
Telegram bot token
Message @BotFather in Telegram
Run /newbot
Copy the token (looks like 123456789:AA...)
Paste it into /setup
​
Discord bot token
Go to https://discord.com/developers/applications
New Application → choose a name
Bot → Add Bot
Enable MESSAGE CONTENT INTENT under Bot → Privileged Gateway Intents (required or the bot will crash on startup)
Copy the Bot Token and paste into /setup
Invite the bot to your server (OAuth2 URL Generator; scopes: bot, applications.commands)
​
Backups & migration
Download a backup at:
https://<your-railway-domain>/setup/export
This exports your OpenClaw state + workspace so you can migrate to another host without losing config or memory.

https://docs.openclaw.ai/install/railway