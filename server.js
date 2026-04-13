/**
 * MailForge Backend — server.js
 * Run: node server.js
 * Requires: npm install express nodemailer cors axios
 */

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.')); // Serve bulk-emailer.html from same folder

// ─── In-memory state ──────────────────────────────────────────────────────────
const transporterCache = {}; // email → nodemailer transporter
const dailySentCounts = {};  // email → { date, count }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

function getDailySent(email) {
  const today = getTodayKey();
  if (!dailySentCounts[email] || dailySentCounts[email].date !== today) {
    dailySentCounts[email] = { date: today, count: 0 };
  }
  return dailySentCounts[email].count;
}

function incrementDailySent(email) {
  const today = getTodayKey();
  if (!dailySentCounts[email] || dailySentCounts[email].date !== today) {
    dailySentCounts[email] = { date: today, count: 0 };
  }
  dailySentCounts[email].count++;
  return dailySentCounts[email].count;
}

function getOrCreateTransporter(email, password, host = 'smtp.gmail.com', port = 587) {
  const key = `${email}:${host}:${port}`;
  if (!transporterCache[key]) {
    transporterCache[key] = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: parseInt(port) === 465,
      auth: { user: email, pass: password },
      tls: { rejectUnauthorized: false },
      pool: true,
      maxConnections: 3,
      rateDelta: 1000,
      rateLimit: 3,
    });
  }
  return transporterCache[key];
}

// Clear cached transporter (e.g. after auth failure)
function clearTransporter(email, host, port) {
  const key = `${email}:${host}:${port}`;
  if (transporterCache[key]) {
    try { transporterCache[key].close(); } catch (_) {}
    delete transporterCache[key];
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Verify a sender account (test SMTP connection)
app.post('/api/verify-sender', async (req, res) => {
  const { email, password, host = 'smtp.gmail.com', port = 587 } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Missing email or password' });

  try {
    const transporter = getOrCreateTransporter(email, password, host, port);
    await transporter.verify();
    res.json({ ok: true, message: `${email} verified successfully` });
  } catch (err) {
    clearTransporter(email, host, port);
    res.json({ ok: false, error: err.message });
  }
});

// Send a single email
app.post('/api/send', async (req, res) => {
  const {
    from_email, from_password, from_name,
    to, subject, body, cc, reply_to,
    daily_limit = 100,
    smtp_host = 'smtp.gmail.com', smtp_port = 587,
    unsubscribe_header = true,
  } = req.body;

  if (!from_email || !from_password || !to || !subject || !body) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Enforce daily limit
  const sent = getDailySent(from_email);
  if (sent >= daily_limit) {
    return res.json({ ok: false, error: `Daily limit reached (${sent}/${daily_limit})`, limitReached: true });
  }

  try {
    const transporter = getOrCreateTransporter(from_email, from_password, smtp_host, smtp_port);

    const fromAddr = from_name ? `"${from_name}" <${from_email}>` : from_email;

    const mailOptions = {
      from: fromAddr,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
      ...(cc ? { cc } : {}),
      ...(reply_to ? { replyTo: reply_to } : {}),
      headers: {
        'X-Mailer': 'MailForge/1.0',
        ...(unsubscribe_header ? { 'List-Unsubscribe': `<mailto:${from_email}?subject=unsubscribe>` } : {}),
      },
    };

    const info = await transporter.sendMail(mailOptions);
    const newCount = incrementDailySent(from_email);

    res.json({
      ok: true,
      messageId: info.messageId,
      sentToday: newCount,
    });

  } catch (err) {
    const isAuthError = err.message.toLowerCase().includes('auth') ||
                        err.message.toLowerCase().includes('invalid') ||
                        err.message.toLowerCase().includes('535') ||
                        err.message.toLowerCase().includes('credentials');

    if (isAuthError) clearTransporter(from_email, smtp_host, smtp_port);

    res.json({ ok: false, error: err.message, isAuthError });
  }
});

// Get daily sent counts for a list of senders
app.post('/api/daily-counts', (req, res) => {
  const { emails } = req.body;
  const result = {};
  (emails || []).forEach(email => { result[email] = getDailySent(email); });
  res.json(result);
});

// Reset daily count for a sender
app.post('/api/reset-daily', (req, res) => {
  const { email } = req.body;
  if (dailySentCounts[email]) delete dailySentCounts[email];
  res.json({ ok: true });
});

// Fetch a Google Sheet as CSV (proxy to avoid CORS)
app.get('/api/fetch-sheet', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  try {
    const response = await axios.get(url, {
      responseType: 'text',
      timeout: 10000,
      headers: { 'User-Agent': 'MailForge/1.0' },
    });
    res.setHeader('Content-Type', 'text/plain');
    res.send(response.data);
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch sheet: ${err.message}` });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  MailForge backend running at http://localhost:${PORT}`);
  console.log(`📧  Open http://localhost:${PORT}/bulk-emailer.html in your browser\n`);
});
