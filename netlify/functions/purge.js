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

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch(e) {}

  const target = body.target || 'all'; // 'messages', 'history', 'all'

  try {
    const app = getAdmin();
    const db = app.database();

    // Verify caller role if token provided
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      const decoded = await app.auth().verifyIdToken(idToken).catch(()=>null);
      if (decoded && decoded.role !== 'superadmin' && decoded.role !== 'admin') {
        return {
          statusCode: 403,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'صرف سپر ایڈمن کو ڈیٹا صاف کرنے کی اجازت ہے' })
        };
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

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true, target, message: 'ڈیٹا بیس کامیابی سے صاف ہو گیا' })
    };
  } catch (error) {
    console.error('Purge error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
