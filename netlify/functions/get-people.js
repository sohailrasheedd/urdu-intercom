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

const DEFAULT_PEOPLE = [
  { id: "sohail",    name: "سہیل",       color: "#1e88e5", loginId: "sohail" },
  { id: "abrar",     name: "ابرار",       color: "#43a047", loginId: "abrar" },
  { id: "ahmedraza", name: "احمد رضا",   color: "#fb8c00", loginId: "ahmedraza" },
  { id: "bapu",      name: "باپو",        color: "#e53935", loginId: "bapu" }
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  try {
    const app = getAdmin();
    const db = app.database();
    const snap = await db.ref('settings/people').once('value');
    const dynamicPeople = snap.val();
    const people = (Array.isArray(dynamicPeople) && dynamicPeople.length > 0) ? dynamicPeople : DEFAULT_PEOPLE;

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify({ people })
    };
  } catch (error) {
    console.warn('get-people error, returning default:', error.message);
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ people: DEFAULT_PEOPLE })
    };
  }
};
