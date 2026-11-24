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

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, 10000, 32, 'sha256').toString('hex');
  return { hash, salt };
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

  const { targetUserId } = body;
  if (!targetUserId) {
    return res.status(400).json({ error: 'صارف کی آئی ڈی درکار ہے' });
  }

  try {
    const app = getAdmin();
    const db = app.database();

    // Verify caller has superadmin role
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      const decoded = await app.auth().verifyIdToken(idToken);
      if (decoded.role !== 'superadmin') {
        return res.status(403).json({ error: 'صرف سپر ایڈمن پن ری سیٹ کر سکتا ہے' });
      }
    }

    const { hash, salt } = hashPin('1234');
    await db.ref(`private/pins/${targetUserId}`).set({
      hash,
      salt,
      changed: false,
      updatedAt: Date.now()
    });

    // Mark public flag as false (1234 default badge)
    await db.ref(`settings/passwordChanged/${targetUserId}`).set(false);
    await db.ref(`settings/passwords/${targetUserId}`).remove();

    return res.status(200).json({ success: true, message: 'پن کوڈ کامیابی سے 1234 پر ری سیٹ کر دیا گیا' });

  } catch (error) {
    console.error('Reset PIN error:', error);
    return res.status(500).json({ error: error.message });
  }
};
