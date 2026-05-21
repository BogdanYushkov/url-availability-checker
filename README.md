# URL Availability Checker via Geo-Targeted Proxies

A Node.js service that **automatically monitors website availability from different countries** using geo-targeted residential proxies. It reads a list of domains from Google Sheets, checks each one through country-specific proxies, and reports failures via Telegram notifications and Google Sheets logging.

## Why This Exists

Websites can be accessible in one country but blocked or down in another. This tool continuously verifies that your domains are reachable from every target country, so you know about geo-specific outages before your users do.

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│ Google Sheet │────▶│   index.js   │────▶│  Proxy Service  │────▶│   Telegram   │
│  (domains)  │     │  (scheduler) │     │ (geo-checking)  │     │  (alerts)    │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────────┘
                           │                                            │
                           └──────── Google Sheet (error log) ◀─────────┘
```

### Step-by-step flow:

1. **Cron triggers** `main()` at scheduled times (default: 09:00 and 16:00 UTC+3)
2. **Google Sheets Service** reads the input spreadsheet — each row contains a country name, ISO code, domains to check, and responsible managers
3. **Proxy Service** creates a geo-targeted proxy session per country (e.g., `cc-UA` for Ukraine, `cc-DE` for Germany) and sends HTTPS requests to each domain through that proxy
4. **Retry logic** — if a request fails, it retries up to 5 times with exponential backoff. For transient errors (502/503/429), there are additional 2nd and 3rd pass retries with longer cooldowns (30s and 60s)
5. **On failure** — sends a Telegram message with the country, domain, error details, and responsible managers
6. **Error logging** — appends all failures to a separate sheet in the same Google Spreadsheet with timestamps

## Project Structure

```
├── index.js                         # Entry point — cron scheduler + main orchestration
├── db.js                            # Project configs (which sheets to read, where to notify)
├── db_test.js                       # Test/staging project config
├── service/
│   ├── proxy-service.js             # Core logic — geo-proxy requests with retry & session rotation
│   ├── google-sheets-service.js     # Google Sheets API — read domains, write error logs
│   └── telegram-service.js          # Telegram Bot API — send alert messages
├── Dockerfile                       # Container image definition
├── docker-compose.yml               # Docker Compose for easy deployment
├── package.json                     # Dependencies and scripts
└── .gitignore
```

## Key Technical Details

### Proxy Service (`service/proxy-service.js`)

- Uses **residential proxies with geo-targeting** (compatible with Oxylabs, Bright Data, etc.)
- Proxy URL format: `http://{user}-cc-{ISO}-sessid-{session}-sesstime-5:{pass}@{host}`
- **Session rotation**: on retryable errors, creates a new proxy session (new IP) automatically
- **Concurrency control**: processes up to 3 countries and 5 domains in parallel using `p-limit`
- **Dual timeout**: 30s axios timeout + 45s hard `AbortController` cutoff
- **3-pass retry strategy**:
  - 1st pass: 5 retries per domain with exponential backoff
  - 2nd pass: re-checks domains that got 502/503/429 after a 30s cooldown
  - 3rd pass: final retry after 60s for still-failing domains
- **Traffic tracking**: counts total domains checked, HTTP requests made, and bytes transferred

### Google Sheets Service (`service/google-sheets-service.js`)

- Authenticates via **Google Service Account** (credentials from env vars)
- Reads input data: country, ISO code, domains (comma-separated), managers (comma-separated)
- Writes error logs: country, domain, error description, timestamp
- Resolves sheet tabs by `gid` (numeric sheet ID), not by name

### Telegram Service (`service/telegram-service.js`)

- Sends HTML-formatted messages via Telegram Bot API
- Reports: which domain failed, in which country, what error occurred, and who to contact

## Google Sheet Format

### Input sheet (read):

| Country | ISO | Domains | Managers | Info |
|---------|-----|---------|----------|------|
| Ukraine | ua  | example.com, example.org | @manager1, @manager2 | optional notes |
| Germany | de  | example.de | @manager3 | |

### Error log sheet (write):

| Country | Domain | Error | Timestamp |
|---------|--------|-------|-----------|
| Ukraine | example.com | Request failed with status code 522 | 13.05.2026, 09:15:30 |

## Setup

### Prerequisites

- Node.js 18+
- A **Google Cloud Service Account** with access to the target Google Spreadsheet
- A **Telegram Bot** (create via [@BotFather](https://t.me/BotFather))
- A **residential proxy provider** with geo-targeting support (e.g., Oxylabs)

### 1. Clone the repository

```bash
git clone https://github.com/BogdanYushkov/Url-availability-checker-with-proxies.git
cd Url-availability-checker-with-proxies
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
# ── Google Sheets Service Account ──
PROJECT_ID=your_project_id
PRIVATE_KEY_ID=your_private_key_id
PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
CLIENT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
CLIENT_ID=123456789
AUTH_URI=https://accounts.google.com/o/oauth2/auth
TOKEN_URI=https://oauth2.googleapis.com/token
AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/your-sa%40your-project.iam.gserviceaccount.com
UNIVERSE_DOMAIN=googleapis.com

# ── Google Sheets ──
GOOGLE_SHEET_ID=your_spreadsheet_id_from_url
GOOGLE_SHEET_WRITE_GID=0

# ── Telegram ──
TELEGRAM_BOT_TOKEN=123456:ABC-DEF12345ghIkl-zyxi57W2v
TELEGRAM_CHAT_ID=-1234567890

# ── Proxy (Oxylabs / Bright Data / etc.) ──
PROXY_USERNAME=your_proxy_user
PROXY_PASSWORD=your_proxy_pass
PROXY=proxy_host:port
```

### 4. Configure projects

Edit `db.js` to set your spreadsheet IDs and Telegram credentials. You can add multiple projects — each will be checked independently:

```js
module.exports = [
    {
        "title": "My Project",
        "docId": process.env.GOOGLE_SHEET_ID,
        "docRead": "0",          // gid of the input sheet tab
        "docWrite": "123456789", // gid of the error log sheet tab
        "telegramToken": process.env.TELEGRAM_BOT_TOKEN,
        "chatId": process.env.TELEGRAM_CHAT_ID,
        "state": true            // set to false to disable
    },
]
```

### 5. Run

```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

## Docker Deployment

### Using Docker directly:

```bash
docker build -t url-availability-checker .

docker run -d --name url-availability-checker \
  --env-file .env \
  --restart unless-stopped \
  url-availability-checker
```

### Using Docker Compose:

```bash
docker-compose up -d

# View logs
docker logs url-availability-checker --tail 50
```

## Tech Stack

| Package | Purpose |
|---------|---------|
| [axios](https://www.npmjs.com/package/axios) | HTTP requests to target domains |
| [https-proxy-agent](https://www.npmjs.com/package/https-proxy-agent) | Route requests through HTTPS proxies |
| [p-limit](https://www.npmjs.com/package/p-limit) | Concurrency control for parallel checks |
| [googleapis](https://www.npmjs.com/package/googleapis) | Google Sheets API (read input / write logs) |
| [node-telegram-bot-api](https://www.npmjs.com/package/node-telegram-bot-api) | Telegram notifications |
| [node-cron](https://www.npmjs.com/package/node-cron) | Cron-based job scheduling |
| [dotenv](https://www.npmjs.com/package/dotenv) | Environment variable management |
