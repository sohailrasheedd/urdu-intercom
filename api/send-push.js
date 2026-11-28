const admin = require('firebase-admin');

let adminApp = null;
function getAdmin() {
  if (adminApp) return adminApp;

  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://intercom-8a920-default-rtdb.firebaseio.com';

  if (!serviceAccountRaw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not configured.');
  }

  let serviceAccount;
  try {
    serviceAccount = typeof serviceAccountRaw === 'string' ? JSON.parse(serviceAccountRaw) : serviceAccountRaw;
    if (serviceAccount && serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } catch (e) {
    throw new Error('Invalid JSON in FIREBASE_SERVICE_ACCOUNT_JSON: ' + e.message);
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

  // CORS Preflight
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

  const { messageId, type } = body;
  if (!messageId && type !== 'token') {
    return res.status(400).json({ error: 'Missing messageId or valid type' });
  }

  try {
    const app = getAdmin();
    const db = app.database();
    const messaging = app.messaging();

    if (type === 'token') {
      // Token Queue notification broadcast
      const tokenSnap = await db.ref('tokens/today').once('value');
      const tokenData = tokenSnap.val();
      if (!tokenData || tokenData.current == null) {
        return res.status(200).json({ success: true, message: 'No active token to notify' });
      }

      const currentNum = tokenData.current;
      const allTokensSnap = await db.ref('fcmTokens').once('value');
      const allTokensObj = allTokensSnap.val() || {};
      const tokensWithMeta = [];
      Object.keys(allTokensObj).forEach(uid => {
        const userTokens = allTokensObj[uid];
        if (userTokens && typeof userTokens === 'object') {
          Object.keys(userTokens).forEach(sanitizedKey => {
            const entry = userTokens[sanitizedKey];
            const tokenStr = typeof entry === 'string' ? entry : (entry && entry.token ? entry.token : sanitizedKey);
            if (tokenStr) {
              tokensWithMeta.push({ token: tokenStr, sanitizedKey, userId: uid });
            }
          });
        }
      });

      if (tokensWithMeta.length === 0) {
        return res.status(200).json({ success: true, pushedTokens: 0 });
      }

      const dataPayload = {
        title: 'ٹوکن اپڈیٹ',
        body: `ٹوکن ${currentNum} کی باری ہے`,
        tag: `token-${currentNum}`,
        url: '/'
      };

      let sentCount = 0;
      for (const item of tokensWithMeta) {
        try {
          await messaging.send({
            token: item.token,
            data: dataPayload,
            webpush: { headers: { Urgency: 'high', TTL: '600' } }
          });
          sentCount++;
        } catch (err) {
          const code = err.code || (err.errorInfo && err.errorInfo.code) || '';
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
            await db.ref(`fcmTokens/${item.userId}/${item.sanitizedKey}`).remove().catch(() => {});
          }
        }
      }

      return res.status(200).json({ success: true, pushedTokens: sentCount, currentToken: currentNum });
    }

    // Verify caller ID token if provided
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    let callerUid = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1].trim();
      try {
        const decoded = await app.auth().verifyIdToken(idToken);
        callerUid = decoded.uid;
      } catch (err) {
        console.warn('ID token verification failed in send-push:', err.message);
      }
    }

    // Read the message directly from the database (tamper-proof)
    const msgSnap = await db.ref('messages').child(messageId).once('value');
    const msg = msgSnap.val();
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if push already processed for this message
    if (msg.pushed) {
      return res.status(200).json({ success: true, alreadyPushed: true });
    }

    // Determine target recipient IDs
    let targetRecipients = [];
    const isPeer = msg.kind === 'peer';

    if (isPeer) {
      // User to user: recipient is msg.to
      if (msg.to) targetRecipients.push(msg.to);
    } else {
      // Thread (admin <-> user)
      const fromIsAdmin = (msg.from === 'admin' || msg.from === 'superadmin');
      if (fromIsAdmin) {
        // Admin to user: recipient is msg.to
        if (msg.to) targetRecipients.push(msg.to);
      } else {
        // User to admin: notify both admin and superadmin
        targetRecipients.push('admin', 'superadmin');
      }
    }

    // Fetch FCM tokens for each target recipient
    const tokensWithMeta = []; // { token, sanitizedKey, userId }
    for (const uid of targetRecipients) {
      const tokenSnap = await db.ref(`fcmTokens/${uid}`).once('value');
      const tokensObj = tokenSnap.val();
      if (tokensObj && typeof tokensObj === 'object') {
        Object.keys(tokensObj).forEach(sanitizedKey => {
          const entry = tokensObj[sanitizedKey];
          const tokenStr = typeof entry === 'string' ? entry : (entry && entry.token ? entry.token : sanitizedKey);
          if (tokenStr) {
            tokensWithMeta.push({
              token: tokenStr,
              sanitizedKey: sanitizedKey,
              userId: uid
            });
          }
        });
      }
    }

    if (tokensWithMeta.length === 0) {
      // Mark as pushed even if no tokens registered currently
      await db.ref(`messages/${messageId}`).update({ pushed: true });
      return res.status(200).json({ success: true, pushedTokens: 0 });
    }

    // Prepare push payload: data-only for reliable background service worker handling
    const senderName = msg.fromName || (msg.from === 'admin' ? 'ایڈمن' : msg.from);
    let bodyText = msg.text || '';
    if (msg.hasAudio || msg.audio) {
      bodyText = '🎙️ صوتی پیغام (Voice Note)';
    } else if (bodyText.length > 120) {
      bodyText = bodyText.substring(0, 117) + '...';
    }

    const dataPayload = {
      title: String(senderName),
      body: String(bodyText),
      tag: String(messageId),
      url: '/'
    };

    const staleTokens = [];
    let sentCount = 0;

    // Send FCM messages
    for (const item of tokensWithMeta) {
      const message = {
        token: item.token,
        data: dataPayload,
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '600'
          }
        }
      };

      try {
        await messaging.send(message);
        sentCount++;
      } catch (err) {
        const code = err.code || (err.errorInfo && err.errorInfo.code) || '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument' ||
          code === 'messaging/invalid-registration-token'
        ) {
          staleTokens.push(item);
        } else {
          console.warn('FCM send error for token:', item.token.slice(0, 12) + '...', err.message);
        }
      }
    }

    // Clean up stale / unregistered tokens from RTDB
    for (const stale of staleTokens) {
      try {
        await db.ref(`fcmTokens/${stale.userId}/${stale.sanitizedKey}`).remove();
      } catch (e) {}
    }

    // Mark message as pushed
    await db.ref(`messages/${messageId}`).update({ pushed: true });

    return res.status(200).json({
      success: true,
      sentCount: sentCount,
      prunedTokens: staleTokens.length
    });

  } catch (error) {
    console.error('Error in send-push function:', error);
    return res.status(500).json({ error: error.message });
  }
};
