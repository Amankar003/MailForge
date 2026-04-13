<<<<<<< HEAD
# MailForge — Bulk Email Automation

A single-user bulk emailer with a full GUI. Uses real Gmail SMTP via Google App Passwords.

---

## 📁 Files

```
mailforge/
├── server.js          ← Node.js backend (SMTP + proxy)
├── bulk-emailer.html  ← GUI (open in browser)
├── package.json       ← Dependencies
└── README.md
```

---

## 🚀 Setup (5 minutes)

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Install dependencies
```bash
cd mailforge
npm install
```

### 3. Start the backend
```bash
node server.js
```
You'll see: `✅ MailForge backend running at http://localhost:3001`

### 4. Open the GUI
Open `bulk-emailer.html` in your browser (double-click the file, or visit `http://localhost:3001/bulk-emailer.html`)

---

## 🔑 Gmail App Password Setup

Gmail requires an **App Password** instead of your regular password.

1. Enable 2-Step Verification: https://myaccount.google.com/security
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Select **Mail** → **Other (Custom)** → name it "MailForge"
4. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)
5. Use this password in MailForge (not your Gmail login password)

---

## 📊 Google Sheet Format

### Sheet 1 — Sender Accounts
| email | password | name | daily_limit |
|-------|----------|------|-------------|
| sender1@gmail.com | abcd efgh ijkl mnop | Alice | 100 |
| sender2@gmail.com | xxxx xxxx xxxx xxxx | Bob | 80 |

### Sheet 2 — Email Queue
| to_email | subject | body | cc | reply_to |
|----------|---------|------|----|----------|
| john@example.com | Hello {name}! | Hi {name}, ... | | |
| jane@example.com | Quick note | Dear {name}, ... | | |

**Personalization tokens:** `{name}` `{email}` `{date}` `{sender}`

### How to publish a Google Sheet as CSV:
1. Open your Google Sheet
2. File → Share → Publish to web
3. Select the specific sheet tab
4. Choose **Comma-separated values (.csv)**
5. Click Publish → copy the URL
6. Paste the URL into MailForge's import field

---

## ⚡ Features

| Feature | Details |
|---------|---------|
| Random sender rotation | Picks a different Gmail account for each email |
| Personalization | `{name}`, `{email}`, `{date}`, `{sender}` tokens |
| Delay control | 5–300 seconds between emails |
| Delay jitter | ±20% random variance to look human |
| Batch sending | Send N emails, then pause longer |
| Daily limits | Per-sender cap tracked across the session |
| Duplicate skip | Never send to the same address twice |
| SMTP verify | Test each account before sending |
| Failure detection | Auto-stop if >40% fail rate |
| Activity log | Full CSV export of all sends |
| Google Sheet proxy | Backend fetches sheets (bypasses CORS) |

---

## 🛡️ Anti-Spam Tips

- Keep delays at **30–60 seconds** minimum
- Use **batch size 5–10** with **2–5 minute batch pauses**
- Keep daily sends under **100/account** (Gmail's safe limit)
- Use multiple sender accounts and rotate
- Personalize every email (avoids spam filters)
- Warm up new accounts gradually (start with 20/day)

---

## 🔧 Troubleshooting

**Backend offline error:**
- Make sure you ran `node server.js`
- Check that port 3001 is not blocked by firewall

**Auth failed for sender:**
- You're using your Gmail login password — use the App Password instead
- Make sure 2FA is enabled on the Google account
- Try regenerating the App Password

**Sheet load fails:**
- Make sure the sheet is published to web as CSV
- The link should contain `pub?output=csv`
- Check that the sheet is not restricted

**Emails going to spam:**
- Increase delay between sends
- Reduce daily volume per sender
- Personalize subject and body
- Ensure SPF/DKIM is set up on your domain (if using custom domain)
=======
# Bulk Emailer Project

A lightweight bulk email sending application built with **Node.js**, **Express**, **Nodemailer**, and a simple **HTML frontend**.  
This tool allows users to send bulk emails using multiple SMTP accounts with sender rotation, daily limits, personalization templates, CSV/Google Sheet imports, and live sending progress.

---

# Features

## Email Sending
- Send bulk emails using SMTP credentials
- Support for Gmail and custom SMTP servers
- Single email testing before bulk send

## Sender Management
- Add and verify multiple sender accounts
- Rotate senders automatically after daily limit is reached
- Track daily send counts per sender
- Reset daily sender counts manually

## Campaign Management
- Create custom email subject/body templates
- Support dynamic merge tags for personalization
- Add CC / Reply-To / Unsubscribe headers

## Recipient Import
- Import recipients via CSV file
- Import recipients from Google Sheets
- Google Sheets CSV proxy fetch support

## Progress Tracking
- Live sending progress UI
- Sent / Failed / Pending counters
- Real-time status updates during campaign

---

# Tech Stack

### Frontend
- HTML5
- CSS3
- Vanilla JavaScript

### Backend
- Node.js
- Express.js

### Libraries Used
- Nodemailer
- Axios
- Express Middleware

---

# Project Architecture

```text
Frontend (bulk-emailer.html)
        ↓
   API Requests (fetch)
        ↓
Backend (Express Server)
        ↓
Business Logic / Services
        ↓
SMTP Provider / Gmail
        ↓
Recipient Inbox
>>>>>>> 8a8a919f0d4f65daa0714ef316c685dcea2a2374
