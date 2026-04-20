/**
 * MailForge Backend — server.js
 * Run: node server.js
 * Requires: npm install express nodemailer cors axios
 */

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// ─── Senders folder (sender account CSVs) ────────────────────────────────────
const SENDERS_DIR = path.join(__dirname, 'Senders');
if (!fs.existsSync(SENDERS_DIR)) {
  fs.mkdirSync(SENDERS_DIR, { recursive: true });
  console.log(`👤  Created "Senders" folder at ${SENDERS_DIR}`);
}

// ─── Email queue folder (recipient list CSVs) ────────────────────────────────
const QUEUE_DIR = path.join(__dirname, 'Email queue');
if (!fs.existsSync(QUEUE_DIR)) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  console.log(`✉️  Created "Email queue" folder at ${QUEUE_DIR}`);
}

// ─── Attachments folder ───────────────────────────────────────────────────────
const ATTACH_DIR = path.join(__dirname, 'Attachments');
if (!fs.existsSync(ATTACH_DIR)) {
  fs.mkdirSync(ATTACH_DIR, { recursive: true });
  console.log(`📎  Created "Attachments" folder at ${ATTACH_DIR}`);
}

// ─── Generic CSV folder helpers (shared by senders + queue endpoints) ────────
function listCsvFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv'))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function safeCsvName(filename) {
  // Strip path separators and restrict to safe chars. Must end with .csv (case-insensitive).
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._\- ]/g, '_');
  return safe;
}

function writeCsvFile(dir, filename, content) {
  const safe = safeCsvName(filename);
  if (!safe.toLowerCase().endsWith('.csv')) {
    return { ok: false, error: 'Only .csv files are allowed' };
  }
  fs.writeFileSync(path.join(dir, safe), content, 'utf8');
  return { ok: true, name: safe };
}

function readCsvFile(dir, name, res) {
  const safe = path.basename(name);
  if (!safe.toLowerCase().endsWith('.csv')) {
    return res.status(400).json({ ok: false, error: 'Only .csv files can be read here' });
  }
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
  try {
    res.setHeader('Content-Type', 'text/plain');
    res.send(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function deleteCsvFile(dir, name, res) {
  const safe = path.basename(name);
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

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
    attachment_name,            // optional: filename from Attachments folder
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

    // Build optional attachment
    const attachments = [];
    if (attachment_name) {
      const safe = path.basename(attachment_name);
      const attachPath = path.join(ATTACH_DIR, safe);
      if (fs.existsSync(attachPath)) {
        attachments.push({ filename: safe, path: attachPath });
      } else {
        console.warn(`⚠️  Attachment not found: ${attachPath}`);
      }
    }

    const mailOptions = {
      from: fromAddr,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
      ...(cc ? { cc } : {}),
      ...(reply_to ? { replyTo: reply_to } : {}),
      ...(attachments.length ? { attachments } : {}),
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

// ─── Attachment endpoints ─────────────────────────────────────────────────────

// List all saved attachment files
app.get('/api/attachments', (req, res) => {
  try {
    const files = fs.readdirSync(ATTACH_DIR)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const stat = fs.statSync(path.join(ATTACH_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Upload an attachment file (base64 encoded)
// Body: { filename: 'resume.pdf', content_base64: '<base64 string>' }
app.post('/api/attachments', (req, res) => {
  const { filename, content_base64 } = req.body;
  if (!filename || !content_base64) {
    return res.status(400).json({ ok: false, error: 'Missing filename or content_base64' });
  }
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._\- ]/g, '_');
  try {
    const buf = Buffer.from(content_base64, 'base64');
    fs.writeFileSync(path.join(ATTACH_DIR, safe), buf);
    res.json({ ok: true, name: safe, size: buf.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete an attachment file
app.delete('/api/attachments/:name', (req, res) => {
  const safe = path.basename(req.params.name);
  const filePath = path.join(ATTACH_DIR, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Senders folder endpoints (sender account CSVs) ──────────────────────────
// List all saved .csv files in Senders/
app.get('/api/senders', (_req, res) => {
  try { res.json({ ok: true, files: listCsvFiles(SENDERS_DIR) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Save (upload) a .csv file to Senders/
// Body: { filename: 'sender.csv', content: '<csv text>' }
app.post('/api/senders', (req, res) => {
  const { filename, content } = req.body;
  if (!filename || content == null) return res.status(400).json({ ok: false, error: 'Missing filename or content' });
  try {
    const r = writeCsvFile(SENDERS_DIR, filename, content);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Read a specific saved .csv file from Senders/
app.get('/api/senders/:name', (req, res) => readCsvFile(SENDERS_DIR, req.params.name, res));

// Delete a saved .csv file from Senders/
app.delete('/api/senders/:name', (req, res) => deleteCsvFile(SENDERS_DIR, req.params.name, res));


// ─── Email queue folder endpoints (recipient list CSVs) ──────────────────────
// List all saved .csv files in "Email queue/"
app.get('/api/queue-files', (_req, res) => {
  try { res.json({ ok: true, files: listCsvFiles(QUEUE_DIR) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Save (upload) a .csv file to "Email queue/"
// Body: { filename: 'email_receiver.csv', content: '<csv text>' }
app.post('/api/queue-files', (req, res) => {
  const { filename, content } = req.body;
  if (!filename || content == null) return res.status(400).json({ ok: false, error: 'Missing filename or content' });
  try {
    const r = writeCsvFile(QUEUE_DIR, filename, content);
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Read a specific saved .csv file from "Email queue/"
app.get('/api/queue-files/:name', (req, res) => readCsvFile(QUEUE_DIR, req.params.name, res));

// Delete a saved .csv file from "Email queue/"
app.delete('/api/queue-files/:name', (req, res) => deleteCsvFile(QUEUE_DIR, req.params.name, res));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  MailForge backend running at http://localhost:${PORT}`);
  console.log(`📧  Open http://localhost:${PORT}/bulk-emailer.html in your browser\n`);
});
