const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'messages_data.json');

let state = {
  messages: [],
  history: [],
  people: [],
  voice: {},
  pinned: {
    "sohail": ["پیناڈول دے دو", "ایک ہفتے کی دوا دے دیں", "دو ہفتے کی دوا دے دیں", "شربت تیار کرو"],
    "abrar": ["ٹوکن چار لے آؤ", "فائل لے کر آئیں", "اوپر آ جائیں"],
    "ahmedraza": ["مریض کو بھیج دیں", "دوا تیار ہے"],
    "ustad": ["اوپر تشریف لائیں", "ایک منٹ رکیں"],
    "bapu": ["چائے لے آئیں", "دوائی دے دیں"]
  },
  adminPermissions: {
    allowedPeople: ["sohail", "abrar", "ahmedraza", "ustad", "bapu"],
    showPinnedPills: true,
    showHistoryBtn: true,
    showVoiceBtn: true,
    showSoundBtn: true
  },
  passwords: {
    "superadmin": "1234",
    "admin": "1234",
    "sohail": "1234",
    "abrar": "1234",
    "ahmedraza": "1234",
    "ustad": "1234",
    "bapu": "1234"
  },
  passwordChanged: {}
};

// Load saved data if exists
try{
  if(fs.existsSync(DATA_FILE)){
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    state.messages = loaded.messages || [];
    state.history = loaded.history || [];
    if(loaded.voice && typeof loaded.voice === 'object') state.voice = loaded.voice;
    if(loaded.people && Array.isArray(loaded.people)) state.people = loaded.people;
    if(loaded.pinned && typeof loaded.pinned === 'object') state.pinned = Object.assign(state.pinned, loaded.pinned);
    if(loaded.adminPermissions && typeof loaded.adminPermissions === 'object') state.adminPermissions = Object.assign(state.adminPermissions, loaded.adminPermissions);
    if(loaded.passwords && typeof loaded.passwords === 'object') state.passwords = Object.assign(state.passwords, loaded.passwords);
    if(loaded.passwordChanged && typeof loaded.passwordChanged === 'object') state.passwordChanged = Object.assign(state.passwordChanged, loaded.passwordChanged);
  }
}catch(e){}

function saveState(){
  try{
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  }catch(e){}
}

// Connected SSE clients
let sseClients = [];
function notifyClients(type, data){
  const payload = `data: ${JSON.stringify({ type, data })}\n\n`;
  sseClients.forEach(res => {
    try{ res.write(payload); }catch(e){}
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const urlParts = req.url.split('?');
  const reqPath = urlParts[0];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS'){
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy Netlify functions to live backend for local development
  if(reqPath.startsWith('/.netlify/functions/')){
    const https = require('https');
    const proxyReq = https.request('https://urdu-intercom-9816.netlify.app' + req.url, {
      method: req.method,
      headers: { ...req.headers, host: 'urdu-intercom-9816.netlify.app' }
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
    req.pipe(proxyReq);
    return;
  }

  // Real-time EventSource
  if(reqPath === '/api/events'){
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // Messages API
  if(reqPath === '/api/messages'){
    if(req.method === 'GET'){
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state.messages));
      return;
    }
    if(req.method === 'POST'){
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try{
          const msg = JSON.parse(body);
          if(!msg.id) msg.id = 'msg_' + Date.now() + '_' + Math.floor(Math.random()*10000);
          if(!msg.time) msg.time = Date.now();
          state.messages.push(msg);
          saveState();
          notifyClients('NEW_MESSAGE', msg);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, msg }));
        }catch(err){
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if(req.method === 'DELETE'){
      state.messages = [];
      saveState();
      notifyClients('CLEAR_ALL_MESSAGES', {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'All active messages cleared' }));
      return;
    }
  }

  // Delete single message API
  if(reqPath.startsWith('/api/messages/') && req.method === 'DELETE'){
    const id = decodeURIComponent(reqPath.replace('/api/messages/', ''));
    // Do NOT delete voice: Keep voice persistently for Super User playback
    const idx = state.messages.findIndex(m => m.id === id);
    if(idx !== -1){
      const removed = state.messages.splice(idx, 1)[0];
      const histItem = {
        id: removed.id,
        voiceId: removed.id,
        to: removed.to,
        from: removed.from,
        fromName: removed.fromName,
        text: removed.text,
        hasAudio: !!removed.hasAudio,
        audioDuration: removed.audioDuration || 0,
        audioMime: removed.audioMime || '',
        audio: (state.voice && state.voice[removed.id]) ? state.voice[removed.id] : (removed.audio || ''),
        time: removed.time,
        sentAt: removed.sentAt || removed.time,
        deliveredAt: removed.deliveredAt || null,
        seenAt: removed.seenAt || null,
        playedAt: removed.playedAt || null,
        replyTo: removed.replyTo || '',
        clearedAt: Date.now()
      };
      state.history.unshift(histItem);
      if(state.history.length > 50) state.history = state.history.slice(0, 50);
      saveState();
      notifyClients('REMOVE_MESSAGE', { id: removed.id, to: removed.to, hist: histItem });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Update message status API (deliveredAt, seenAt, playedAt)
  if(reqPath.startsWith('/api/messages/') && (req.method === 'PATCH' || req.method === 'PUT')){
    const id = decodeURIComponent(reqPath.replace('/api/messages/', ''));
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try{
        const updates = JSON.parse(body);
        const msg = state.messages.find(m => m.id === id);
        if(msg){
          Object.assign(msg, updates);
          saveState();
          notifyClients('MESSAGE_UPDATED', { id, updates, msg });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, msg }));
      }catch(err){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Tokens API (Local & Offline Fallback)
  if(reqPath === '/api/tokens/today'){
    if(!state.tokens) state.tokens = null;
    if(req.method === 'GET'){
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state.tokens || {}));
      return;
    }
    if(req.method === 'POST' || req.method === 'PUT'){
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try{
          const data = JSON.parse(body);
          state.tokens = data;
          saveState();
          notifyClients('TOKENS_UPDATED', data);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, tokens: state.tokens }));
        }catch(e){
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // Voice storage API
  if(reqPath === '/api/voice' && req.method === 'POST'){
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try{
        const data = JSON.parse(body);
        if(!state.voice) state.voice = {};
        if(data.id && data.audio){
          state.voice[data.id] = data.audio;
          saveState();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      }catch(e){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if(reqPath.startsWith('/api/voice/') && req.method === 'GET'){
    const vid = decodeURIComponent(reqPath.replace('/api/voice/', ''));
    if(!state.voice) state.voice = {};
    const audioData = state.voice[vid] || '';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ audio: audioData }));
    return;
  }


  // History API
  if(reqPath === '/api/history'){
    if(req.method === 'GET'){
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state.history));
      return;
    }
    if(req.method === 'DELETE'){
      state.history = [];
      saveState();
      notifyClients('CLEAR_HISTORY', {});
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'All history cleared' }));
      return;
    }
  }

  // Settings API (Manage staff, pinned messages, admin permissions & passwords)
  if(reqPath === '/api/settings'){
    if(req.method === 'GET'){
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        people: state.people,
        pinned: state.pinned,
        adminPermissions: state.adminPermissions,
        passwords: state.passwords,
        passwordChanged: state.passwordChanged
      }));
      return;
    }
    if(req.method === 'POST'){
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try{
          const payload = JSON.parse(body);
          if(payload.people && Array.isArray(payload.people)) state.people = payload.people;
          if(payload.pinned && typeof payload.pinned === 'object') state.pinned = payload.pinned;
          if(payload.adminPermissions && typeof payload.adminPermissions === 'object') state.adminPermissions = payload.adminPermissions;
          if(payload.passwords && typeof payload.passwords === 'object') state.passwords = payload.passwords;
          if(payload.passwordChanged && typeof payload.passwordChanged === 'object') state.passwordChanged = payload.passwordChanged;
          saveState();
          notifyClients('SETTINGS_UPDATED', {
            people: state.people,
            pinned: state.pinned,
            adminPermissions: state.adminPermissions,
            passwords: state.passwords,
            passwordChanged: state.passwordChanged
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        }catch(err){
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  // Change Password API
  if(reqPath === '/api/change-password' && req.method === 'POST'){
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try{
        const data = JSON.parse(body);
        const { userId, newPin } = data;
        if(!userId || !newPin || !/^\d{4}$/.test(newPin)){
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'پن کوڈ لازماً ۴ ہندسوں کا ہونا چاہیے' }));
          return;
        }
        state.passwords[userId] = newPin;
        state.passwordChanged[userId] = true;
        saveState();
        notifyClients('SETTINGS_UPDATED', {
          people: state.people,
          pinned: state.pinned,
          adminPermissions: state.adminPermissions,
          passwords: state.passwords,
          passwordChanged: state.passwordChanged
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      }catch(err){
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static files
  let safePath = reqPath;
  if(safePath === '/' || safePath === '') safePath = '/index.html';
  const filePath = path.join(__dirname, decodeURIComponent(safePath));

  fs.readFile(filePath, (err, data) => {
    if(err){
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('فائل نہیں ملی (404 Not Found)');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`انٹر کام سرور چل رہا ہے: http://localhost:${PORT}`);
});
