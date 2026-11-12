// ===================================================================
//  CEASER WEB PAIR — runs on Render. Stores NOTHING but phone numbers
//  and pairing codes in memory for a few minutes. Every WhatsApp
//  session itself is created and stored only on your Pterodactyl
//  console, because createSocket()/requestPairingWithCustomCode()
//  never run here — this file only queues jobs and shows the result.
// ===================================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- config ----
const POLL_SECRET = process.env.WEBPAIR_SECRET || 'change-me';   // must match the value set on Pterodactyl
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'your_bot';
const DEV_TELEGRAM_USERNAME = process.env.DEV_TELEGRAM_USERNAME || 'your_username';
const JOB_TTL_MS = 3 * 60 * 1000;      // a job not picked up / not completed in 3 min is dropped

// ---- in-memory job queue (fine for this: jobs live seconds, not days) ----
const jobs = new Map();   // id -> { phone, status: pending|sent|done|error, code, displayCode, error, createdAt }

function cleanup(){
  const now = Date.now();
  for(const [id, j] of jobs){ if(now - j.createdAt > JOB_TTL_MS) jobs.delete(id); }
}
setInterval(cleanup, 30000);

function requireSecret(req, res, next){
  if(req.get('x-poll-secret') !== POLL_SECRET) return res.status(401).json({ error: 'bad secret' });
  next();
}

// ---- 1) the webpage calls this when someone submits their number ----
app.post('/api/request-pair', (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '');
  if(!/^\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid number with country code, digits only.' });
  const id = crypto.randomBytes(8).toString('hex');
  jobs.set(id, { phone, status: 'pending', createdAt: Date.now() });
  res.json({ id });
});

// ---- 2) the webpage polls this until the code is ready ----
app.get('/api/job/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if(!j) return res.status(404).json({ error: 'expired, please try again' });
  res.json({ status: j.status, displayCode: j.displayCode || null, error: j.error || null });
});

// ---- 3) Pterodactyl polls THIS every few seconds (outbound call FROM Pterodactyl, so nothing is ever exposed inbound there) ----
app.get('/api/pending-jobs', requireSecret, (req, res) => {
  const out = [];
  for(const [id, j] of jobs){ if(j.status === 'pending'){ j.status = 'sent'; out.push({ id, phone: j.phone }); } }
  res.json(out);
});

// ---- 4) Pterodactyl posts the result back here once it has generated the real pairing code ----
app.post('/api/job/:id/result', requireSecret, (req, res) => {
  const j = jobs.get(req.params.id);
  if(!j) return res.status(404).json({ error: 'job gone' });
  if(req.body.error){ j.status = 'error'; j.error = String(req.body.error).slice(0, 200); }
  else { j.status = 'done'; j.displayCode = String(req.body.displayCode || ''); }
  res.json({ ok: true });
});

// ---- page config (so the frontend knows your Telegram links without hardcoding) ----
app.get('/api/config', (req, res) => {
  res.json({ telegramBot: TELEGRAM_BOT_USERNAME, devHandle: DEV_TELEGRAM_USERNAME });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Web pair server listening on ${PORT}`));
