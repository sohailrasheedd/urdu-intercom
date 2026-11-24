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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const app = getAdmin();
    const db = app.database();
    const snap = await db.ref('settings/people').once('value');
    const dynamicPeople = snap.val();
    const people = (Array.isArray(dynamicPeople) && dynamicPeople.length > 0) ? dynamicPeople : DEFAULT_PEOPLE;

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).json({ people });
  } catch (error) {
    console.warn('get-people error, returning default:', error.message);
    return res.status(200).json({ people: DEFAULT_PEOPLE });
  }
};
