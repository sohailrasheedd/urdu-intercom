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

  const { newPin, userId: requestedUserId } = body;

  if (!newPin || !/^\d{4}$/.test(newPin)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'پن کوڈ لازماً ۴ ہندسوں پر مشتمل ہونا چاہیے' })
    };
  }

  if (newPin === '1234') {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'نیا پن کوڈ 1234 نہیں ہو سکتا' })
    };
  }

  try {
    const app = getAdmin();
    const db = app.database();

    let targetUserId = requestedUserId;

    // Verify caller ID token if provided
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      const decoded = await app.auth().verifyIdToken(idToken);
      // User can change their own PIN, or superadmin can change anyone's
      if (decoded.role !== 'superadmin' && requestedUserId && requestedUserId !== decoded.uid) {
        return {
          statusCode: 403,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'اختیار نہیں ہے' })
        };
      }
      targetUserId = requestedUserId || decoded.uid;
    }

    if (!targetUserId) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'صارف کی آئی ڈی درکار ہے' })
      };
    }

    const { hash, salt } = hashPin(newPin);
    await db.ref(`private/pins/${targetUserId}`).set({
      hash,
      salt,
      changed: true,
      updatedAt: Date.now()
    });

    // Update public changed flag for UI display (green badge)
    await db.ref(`settings/passwordChanged/${targetUserId}`).set(true);

    // Delete plain-text password from settings if still present
    await db.ref(`settings/passwords/${targetUserId}`).remove();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: 'پن کوڈ کامیابی سے تبدیل ہو گیا' })
    };

  } catch (error) {
    console.error('Change PIN error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
