/**
 * Dhan Vault — Credit Cards Gmail sync (Google Apps Script)
 *
 * Runs inside YOUR Gmail account (script.google.com), every 15 minutes:
 *   1. finds new emails from HDFC (alerts + card/EMI statements),
 *   2. posts them to the dashboard's /api/cards/ingest (statement PDFs included,
 *      the dashboard unlocks them with the password you saved on the page),
 *   3. asks /api/cards/reminders for any due-date reminders,
 *   4. emails you every alert/reminder that comes back.
 * Nothing else ever reads your mailbox.
 *
 * Setup (once):
 *   1. https://script.google.com → New project → paste this whole file.
 *   2. Project Settings (gear) → Script Properties → add:
 *        DHAN_URL     = https://dhan-dashboardnn.vercel.app
 *        INGEST_SECRET = <CARD_INGEST_SECRET from Vercel>
 *   3. Pick "setup" in the function dropdown → Run → allow access.
 *      It back-fills the last 200 days, then installs the 15-minute trigger.
 */

var SENDERS = 'from:(alerts@hdfcbank.bank.in OR emailstatements.cards@hdfcbank.bank.in)';

function props_() { return PropertiesService.getScriptProperties(); }
function cfg_() {
  var p = props_();
  var url = (p.getProperty('DHAN_URL') || '').replace(/\/$/, '');
  var secret = p.getProperty('INGEST_SECRET');
  if (!url || !secret) throw new Error('Set DHAN_URL and INGEST_SECRET in Project Settings → Script Properties');
  return { url: url, secret: secret };
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  props_().setProperty('LAST_SYNC', String(Math.floor(Date.now() / 1000) - 200 * 86400));
  sync_(true);
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(15).create();
  Logger.log('Done. Back-fill complete and the 15-minute trigger is on.');
}

function sync() { sync_(false); }

function sync_(backfill) {
  var c = cfg_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var started = Math.floor(Date.now() / 1000);
    var last = Number(props_().getProperty('LAST_SYNC') || (started - 2 * 86400));
    var after = last - 3600; // 1h overlap; the dashboard ignores duplicates
    var batch = [];
    var start = 0;
    while (true) {
      // The back-fill skips everyday savings-account alerts to stay inside
      // Apps Script's 6-minute limit; regular runs take everything.
      var q = SENDERS + ' after:' + after + (backfill ? ' ("Credit Card" OR statement OR "Debit Card" OR mandate)' : '');
      var threads = GmailApp.search(q, start, 100);
      if (!threads.length) break;
      threads.forEach(function (th) {
        th.getMessages().forEach(function (m) {
          if (m.getDate().getTime() / 1000 < after) return;
          var msg = toPayload_(m);
          if (msg.attachments && msg.attachments.length) post_(c, [msg], backfill);
          else { batch.push(msg); if (batch.length >= 40) { post_(c, batch, backfill); batch = []; } }
        });
      });
      if (threads.length < 100) break;
      start += 100;
    }
    if (batch.length) post_(c, batch, backfill);

    // Statements the dashboard couldn't read yet (e.g. password saved later).
    var need = fetchJson_(c.url + '/api/cards/ingest?need=statements&secret=' + encodeURIComponent(c.secret));
    (need && need.ids || []).forEach(function (id) {
      try { post_(c, [toPayload_(GmailApp.getMessageById(id))], backfill); } catch (e) { Logger.log('resend ' + id + ': ' + e); }
    });

    props_().setProperty('LAST_SYNC', String(started));

    var rem = fetchJson_(c.url + '/api/cards/reminders?secret=' + encodeURIComponent(c.secret));
    sendAll_(rem && rem.emails);
  } finally {
    lock.releaseLock();
  }
}

function toPayload_(m) {
  var out = {
    id: m.getId(),
    from: m.getFrom(),
    subject: m.getSubject(),
    date: m.getDate().toISOString(),
    body: m.getPlainBody() || m.getBody(),
  };
  if (/emailstatements\.cards@/i.test(m.getFrom())) {
    out.attachments = m.getAttachments({ includeInlineImages: false })
      .filter(function (a) { return /pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName()); })
      .map(function (a) { return { name: a.getName(), mimeType: a.getContentType(), data: Utilities.base64Encode(a.getBytes()) }; });
  }
  return out;
}

function post_(c, messages, backfill) {
  var res = UrlFetchApp.fetch(c.url + '/api/cards/ingest?secret=' + encodeURIComponent(c.secret), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ messages: messages, backfill: !!backfill }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) { Logger.log('ingest ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300)); return; }
  var j = JSON.parse(res.getContentText());
  sendAll_(j.emails);
}

function fetchJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { Logger.log(url.split('?')[0] + ' ' + res.getResponseCode()); return null; }
  return JSON.parse(res.getContentText());
}

function sendAll_(emails) {
  if (!emails || !emails.length) return;
  var me = Session.getEffectiveUser().getEmail();
  emails.forEach(function (e) { GmailApp.sendEmail(me, e.subject, e.text, { htmlBody: e.html, name: 'Dhan Vault · Cards' }); });
}
