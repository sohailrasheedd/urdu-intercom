const admin = require('firebase-admin');
const crypto = require('crypto');

let adminApp = null;
function getAdmin() {
  if (adminApp) return adminApp;

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://intercom-8a920-default-rtdb.firebaseio.com';

  if (!serviceAccountRaw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = typeof serviceAccountRaw === 'string' ? JSON.parse(serviceAccountRaw) : serviceAccountRaw;
  if (serviceAccount && serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  if (!admin.apps.length) {
    adminApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: databaseURL
    });
  } else {
    adminApp = admin.app();
  }
  return adminApp;
}

const DEFAULT_PEOPLE = [
  { id: "sohail",    name: "سہیل",       color: "#1e88e5", loginId: "sohail" },
  { id: "abrar",     name: "ابرار",       color: "#43a047", loginId: "abrar" },
  { id: "ahmedraza", name: "احمد رضا",   color: "#fb8c00", loginId: "ahmedraza" },
  { id: "bapu",      name: "باپو",        color: "#e53935", loginId: "bapu" }
];

function hashPin(pin, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, 10000, 32, 'sha256').toString('hex');
  return { hash, salt };
}

function verifyPin(pin, hash, salt) {
  const computed = crypto.pbkdf2Sync(String(pin), salt, 10000, 32, 'sha256').toString('hex');
  return computed === hash;
}

function setCors(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.origin;
  let allow = '*';
  if (allowedOrigin) {
    const list = allowedOrigin.split(',').map(s => s.trim());
    if (origin && list.includes(origin)) {
      allow = origin;
    } else if (list.length > 0) {
      allow = list[0];
    }
  }
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON request body' });
    }
  }
  if (!body || typeof body !== 'object') {
    body = {};
  }

  const loginInput = (body.loginId || '').trim().toLowerCase();
  const pinInput = (body.pin || '').trim();

  if (!loginInput || !pinInput) {
    return res.status(400).json({ error: 'آئی ڈی اور پن کوڈ دونوں درج کریں' });
  }

  try {
    const app = getAdmin();
    const db = app.database();

    // 1. Fetch people from settings to resolve user identity
    const peopleSnap = await db.ref('settings/people').once('value');
    const dynamicPeople = peopleSnap.val();
    const activePeople = (Array.isArray(dynamicPeople) && dynamicPeople.length > 0) ? dynamicPeople : DEFAULT_PEOPLE;

    let targetUser = null;
    if (loginInput === 'superadmin' || loginInput === 'super') {
      targetUser = { role: 'superadmin', id: 'superadmin', name: 'سپر ایڈمن', color: '#7c3aed' };
    } else if (loginInput === 'admin') {
      targetUser = { role: 'admin', id: 'admin', name: 'ایڈمن', color: '#2563eb' };
    } else {
      let match = activePeople.find(p => {
        const lid = (p.loginId || p.id || '').toLowerCase();
        const pid = (p.id || '').toLowerCase();
        const pName = (p.name || '').toLowerCase();
        return (loginInput === lid || loginInput === pid || loginInput === pName);
      });
      if (!match) {
        match = DEFAULT_PEOPLE.find(p => {
          const lid = (p.loginId || p.id || '').toLowerCase();
          const pid = (p.id || '').toLowerCase();
          const pName = (p.name || '').toLowerCase();
          return (loginInput === lid || loginInput === pid || loginInput === pName);
        });
      }
      if (match) {
        targetUser = { role: 'user', id: match.id, name: match.name, color: match.color || '#1e88e5' };
      }
    }

    if (!targetUser) {
      return res.status(401).json({ error: 'آئی ڈی یا نام درست نہیں ہے' });
    }

    // Check dynamic maintenance mode from settings/maintenance
    let maint = null;
    try {
      const maintSnap = await db.ref('settings/maintenance').once('value');
      maint = maintSnap.val();
    } catch (maintErr) {
      console.error('Failed to read maintenance settings:', maintErr);
      return res.status(500).json({ error: 'مینٹیننس سٹیٹس چیک کرنے میں خرابی ہوئی۔ برائے مہربانی دوبارہ کوشش کریں۔' });
    }

    if (maint && maint.enabled) {
      const testers = Array.isArray(maint.testers) ? maint.testers : [];
      const isTester = testers.includes(targetUser.id) || (targetUser.loginId && testers.includes(targetUser.loginId));
      if (targetUser.role !== 'superadmin' && !isTester) {
        return res.status(403).json({
          error: maint.message || '⚠️ اس وقت سائٹ مینٹیننس کی وجہ سے بلاک ہے۔ برائے مہربانی کام مکمل ہونے کا انتظار فرمائیں۔',
          maintenance: true
        });
      }
    }

    // 2. Check PIN from private/pins/{targetUser.id}
    const pinSnap = await db.ref(`private/pins/${targetUser.id}`).once('value');
    let pinRecord = pinSnap.val();

    // Migration logic if private/pins doesn't exist yet
    if (!pinRecord) {
      const legacySnap = await db.ref(`settings/passwords/${targetUser.id}`).once('value');
      const legacyPin = legacySnap.val() || '1234';

      if (pinInput !== legacyPin) {
        return res.status(401).json({ error: 'پاس ورڈ یا پن کوڈ غلط ہے' });
      }

      // Check legacy changed flag
      const flagSnap = await db.ref(`settings/passwordChanged/${targetUser.id}`).once('value');
      const wasChanged = flagSnap.val() === true && legacyPin !== '1234';

      // Migrate to private/pins
      const { hash, salt } = hashPin(pinInput);
      pinRecord = { hash, salt, changed: wasChanged, updatedAt: Date.now() };
      await db.ref(`private/pins/${targetUser.id}`).set(pinRecord);

      // Remove legacy plain-text password to prevent leakage
      await db.ref(`settings/passwords/${targetUser.id}`).remove();
    } else {
      // Verify salted hash
      const isValid = verifyPin(pinInput, pinRecord.hash, pinRecord.salt);
      if (!isValid) {
        return res.status(401).json({ error: 'پاس ورڈ یا پن کوڈ غلط ہے' });
      }
    }

    const mustChangePin = (!pinRecord.changed) || (pinInput === '1234');

    // 3. Create Firebase Custom Token with role claim
    const customToken = await app.auth().createCustomToken(targetUser.id, {
      role: targetUser.role,
      name: targetUser.name
    });

    return res.status(200).json({
      customToken,
      user: targetUser,
      mustChangePin
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: error.message });
  }
};
