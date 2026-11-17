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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON request body' })
    };
  }

  const { targetUserId } = body;
  if (!targetUserId) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'صارف کی آئی ڈی درکار ہے' })
    };
  }

  try {
    const app = getAdmin();
    const db = app.database();

    // Verify caller has superadmin role
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      const decoded = await app.auth().verifyIdToken(idToken);
      if (decoded.role !== 'superadmin') {
        return {
          statusCode: 403,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'صرف سپر ایڈمن پن ری سیٹ کر سکتا ہے' })
        };
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

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: 'پن کوڈ کامیابی سے 1234 پر ری سیٹ کر دیا گیا' })
    };

  } catch (error) {
    console.error('Reset PIN error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
