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
  { id: "ustad",     name: "استاد صاحب", color: "#8e24aa", loginId: "ustad" },
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

  const loginInput = (body.loginId || '').trim().toLowerCase();
  const pinInput = (body.pin || '').trim();

  if (!loginInput || !pinInput) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'آئی ڈی اور پن کوڈ دونوں درج کریں' })
    };
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
      const match = activePeople.find(p => {
        const lid = (p.loginId || p.id).toLowerCase();
        const pid = p.id.toLowerCase();
        const pName = (p.name || '').toLowerCase();
        return (loginInput === lid || loginInput === pid || loginInput === pName);
      });
      if (match) {
        targetUser = { role: 'user', id: match.id, name: match.name, color: match.color || '#1e88e5' };
      }
    }

    if (!targetUser) {
      return {
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'آئی ڈی یا نام درست نہیں ہے' })
      };
    }

    // 2. Check PIN from private/pins/{targetUser.id}
    const pinSnap = await db.ref(`private/pins/${targetUser.id}`).once('value');
    let pinRecord = pinSnap.val();

    // Migration logic if private/pins doesn't exist yet
    if (!pinRecord) {
      const legacySnap = await db.ref(`settings/passwords/${targetUser.id}`).once('value');
      const legacyPin = legacySnap.val() || '1234';

      if (pinInput !== legacyPin) {
        return {
          statusCode: 401,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'پاس ورڈ یا پن کوڈ غلط ہے' })
        };
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
        return {
          statusCode: 401,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'پاس ورڈ یا پن کوڈ غلط ہے' })
        };
      }
    }

    const mustChangePin = (!pinRecord.changed) || (pinInput === '1234');

    // 3. Create Firebase Custom Token with role claim
    const customToken = await app.auth().createCustomToken(targetUser.id, {
      role: targetUser.role,
      name: targetUser.name
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        customToken,
        user: targetUser,
        mustChangePin
      })
    };

  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
