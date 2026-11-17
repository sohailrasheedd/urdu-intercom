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

exports.handler = async (event, context) => {
  // CORS Preflight
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

  const { messageId, type } = body;
  if (!messageId && type !== 'token') {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing messageId or valid type' })
    };
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
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: true, message: 'No active token to notify' })
        };
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
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: true, pushedTokens: 0 })
        };
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
            await db.ref(`fcmTokens/${item.userId}/${item.sanitizedKey}`).remove().catch(()=>{});
          }
        }
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, pushedTokens: sentCount, currentToken: currentNum })
      };
    }

    // Verify caller ID token if provided (Task F)
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
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
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Message not found' })
      };
    }

    // Check if push already processed for this message
    if (msg.pushed) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, alreadyPushed: true })
      };
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
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, pushedTokens: 0 })
      };
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

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        sentCount: sentCount,
        prunedTokens: staleTokens.length
      })
    };

  } catch (error) {
    console.error('Error in send-push function:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
