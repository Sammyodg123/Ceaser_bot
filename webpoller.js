// ===================================================================
//  WEB-PAIR POLLER — add this to the SAME process as index.js / Telegram.js
//  on Pterodactyl. Nothing about Telegram.js changes or stops running;
//  this just adds one more outbound loop alongside it, so both stay active.
//
//  How it fits in:
//  1. index.js keeps creating + storing every session locally, same as today.
//  2. Telegram.js keeps polling Telegram normally, same as today.
//  3. This file polls YOUR Render web app every few seconds (outbound call,
//     so Pterodactyl's inbound restrictions never matter here).
//  4. When the web page asks for a pairing code, this calls the SAME
//     requestPairingWithCustomCode() your bot already uses, so the
//     session is created and saved on this console - never on Render.
//
//  Setup:
//   - In index.js, after creating CeaserAPI, add near the bottom (before
//     module.exports or right after it is defined):
//       require('./webpoller.js')(CeaserAPI);
//   - Set these two env vars (same values on both Render and Pterodactyl):
//       WEBPAIR_URL     = https://your-app.onrender.com
//       WEBPAIR_SECRET  = a long random string you make up
// ===================================================================
module.exports = function startWebPoller(CeaserAPI){
  const WEBPAIR_URL = process.env.WEBPAIR_URL;
  const WEBPAIR_SECRET = process.env.WEBPAIR_SECRET;
  if(!WEBPAIR_URL || !WEBPAIR_SECRET){
    console.log('[webpair] WEBPAIR_URL / WEBPAIR_SECRET not set - web pairing page disabled (Telegram still works as normal)');
    return;
  }

  const { requestPairingWithCustomCode } = CeaserAPI;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let busy = false;

  async function tick(){
    if(busy) return;
    busy = true;
    try{
      const r = await fetch(WEBPAIR_URL + '/api/pending-jobs', { headers: { 'x-poll-secret': WEBPAIR_SECRET }, signal: AbortSignal.timeout(15000) });
      if(!r.ok) throw new Error('pending-jobs HTTP ' + r.status);
      const jobs = await r.json();
      for(const job of jobs){
        try{
          console.log(`[webpair] generating code for ${job.phone} (web request ${job.id})`);
          const res = await requestPairingWithCustomCode(job.phone);
          await fetch(WEBPAIR_URL + '/api/job/' + job.id + '/result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-poll-secret': WEBPAIR_SECRET },
            body: JSON.stringify({ displayCode: res.displayCode }),
            signal: AbortSignal.timeout(15000)
          });
        }catch(e){
          console.log(`[webpair] failed for ${job.phone}:`, e.message);
          try{
            await fetch(WEBPAIR_URL + '/api/job/' + job.id + '/result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-poll-secret': WEBPAIR_SECRET },
              body: JSON.stringify({ error: e.message || 'pairing failed' }),
              signal: AbortSignal.timeout(15000)
            });
          }catch(e2){}
        }
      }
    }catch(e){
      console.log('[webpair] poll error:', e.message);
    }finally{
      busy = false;
    }
  }

  setInterval(tick, 3000);
  console.log('[webpair] polling', WEBPAIR_URL, 'every 3s - Telegram.js keeps running unaffected');
};
