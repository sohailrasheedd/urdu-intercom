const admin = require('firebase-admin');

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
      body = {};
    }
  }
  if (!body || typeof body !== 'object') {
    body = {};
  }

  const target = body.target || 'all'; // 'messages', 'history', 'all'

  try {
    const app = getAdmin();
    const db = app.database();

    // Verify caller role if token provided
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      const decoded = await app.auth().verifyIdToken(idToken).catch(() => null);
      if (decoded && decoded.role !== 'superadmin' && decoded.role !== 'admin') {
        return res.status(403).json({ error: 'صرف سپر ایڈمن کو ڈیٹا صاف کرنے کی اجازت ہے' });
      }
    }

    if (target === 'messages' || target === 'active') {
      await db.ref('messages').remove();
      await db.ref('voice').remove();
    } else if (target === 'history') {
      await db.ref('history').remove();
    } else {
      // all
      await db.ref('messages').remove();
      await db.ref('voice').remove();
      await db.ref('history').remove();
    }

    return res.status(200).json({
      success: true,
      target,
      message: 'ڈیٹا بیس کامیابی سے صاف ہو گیا'
    });
  } catch (error) {
    console.error('Purge error:', error);
    return res.status(500).json({ error: error.message });
  }
};
