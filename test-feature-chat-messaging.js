/**
 * EcoCycle AI — Feature 2: In-Platform Buyer-Seller Chat Test Suite
 */

const http = require('http');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

let BASE;

function request(method, urlPath, body, headers = {}, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const reqHeaders = { ...headers };
    if (cookie) reqHeaders['Cookie'] = cookie;
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        const setCookie = res.headers['set-cookie'];
        resolve({
          status: res.statusCode,
          body: parsed,
          setCookie: setCookie ? (Array.isArray(setCookie) ? setCookie : [setCookie]) : []
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function jsonPost(urlPath, obj, cookie = '', headers = {}) {
  return request(
    'POST',
    urlPath,
    JSON.stringify(obj),
    {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...headers
    },
    cookie
  );
}

function jsonGet(urlPath, cookie = '') {
  return request('GET', urlPath, null, {}, cookie);
}

function extractCookie(setCookieArray) {
  for (const c of setCookieArray) {
    if (c.startsWith('ecocycle_sid=')) return c.split(';')[0];
  }
  return '';
}

async function runAllTests() {
  console.log('===================================================================');
  console.log('   EcoCycle AI — Feature 2: In-Platform Buyer-Seller Chat Suite    ');
  console.log('===================================================================');

  // Reset database
  await jsonPost('/api/reset?users=true', {});

  // 1. Setup Seller, Buyer, and Third-party Eve
  console.log('\n--- 1. User Setup ---');
  const sellerReg = await jsonPost('/api/auth/register', {
    name: 'Suresh Kumar (Seller)',
    email: 'suresh@seller.com',
    password: 'password-passphrase-seller-15chars',
    role: 'SELLER'
  });
  const sellerCookie = extractCookie(sellerReg.setCookie);
  const sellerUser = sellerReg.body.user;

  const buyerReg = await jsonPost('/api/auth/register', {
    name: 'GreenPlast Buyer',
    email: 'buyer@greenplast.com',
    password: 'password-passphrase-buyer-15chars',
    role: 'BUYER'
  });
  const buyerCookie = extractCookie(buyerReg.setCookie);
  const buyerUser = buyerReg.body.user;

  const eveReg = await jsonPost('/api/auth/register', {
    name: 'Eve Interloper',
    email: 'eve@outside.com',
    password: 'password-passphrase-eve-15chars',
    role: 'BUYER'
  });
  const eveCookie = extractCookie(eveReg.setCookie);

  // Seller creates a private listing
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 85,
    locality: 'South Hub',
    condition: 'Clean'
  }, sellerCookie);
  const listingId = listRes.body.listing.id;
  log(Boolean(listingId), 'Seller created listing: ' + listingId);

  // 2. Open Conversation Thread
  console.log('\n--- 2. Open Conversation Thread ---');
  const openConvRes = await jsonPost('/api/conversations', {
    listing_id: listingId,
    initial_message: 'Hi Suresh, is this 85kg PET batch available for pickup this Saturday?'
  }, buyerCookie);

  log(openConvRes.status === 201, 'Buyer initiates conversation (HTTP 201)');
  const conv = openConvRes.body.conversation;
  log(Boolean(conv && conv.id), 'Conversation ID assigned: ' + (conv ? conv.id : ''));
  log(conv.seller_id === sellerUser.id, 'Conversation correctly associates seller');
  log(conv.buyer_id === buyerUser.id, 'Conversation correctly associates buyer');
  log(Boolean(openConvRes.body.message), 'Initial message was staged and persisted');

  // Verify Seller receives unread notification
  const sellerNotifs = await jsonGet('/api/notifications', sellerCookie);
  log(sellerNotifs.status === 200, 'GET /api/notifications returns 200');
  log(sellerNotifs.body.unread_count >= 1, 'Seller unread notification count >= 1');
  log(sellerNotifs.body.notifications.some(n => n.type === 'NEW_MESSAGE'), 'Contains NEW_MESSAGE notification');

  // 3. Message Exchange & Read State Updates
  console.log('\n--- 3. Message Exchange & Read Receipts ---');
  // Seller reads conversation messages -> updates read receipts
  const readMsgRes = await jsonGet(`/api/conversations/${conv.id}/messages`, sellerCookie);
  log(readMsgRes.status === 200, 'Seller reads conversation messages (HTTP 200)');
  log(readMsgRes.body.messages.length >= 1, 'Returns message history with initial message');

  // Seller sends a reply
  const replyRes = await jsonPost(`/api/conversations/${conv.id}/messages`, {
    body: 'Yes, Saturday morning works! The bottles are sorted and baled.'
  }, sellerCookie);
  log(replyRes.status === 201, 'Seller replies inside the platform (HTTP 201)');
  log(replyRes.body.message.body.includes('Saturday morning works'), 'Reply body persisted correctly');

  // Buyer checks notifications
  const buyerNotifs = await jsonGet('/api/notifications', buyerCookie);
  log(buyerNotifs.body.unread_count >= 1, 'Buyer notified of new incoming message');

  // Buyer polls for messages since previous timestamp
  const sinceTime = new Date(Date.now() - 5000).toISOString();
  const pollRes = await jsonGet(`/api/conversations/${conv.id}/messages?since=${encodeURIComponent(sinceTime)}`, buyerCookie);
  log(pollRes.status === 200, 'Near-real-time polling with ?since= parameter works (HTTP 200)');
  log(pollRes.body.messages.some(m => m.body.includes('Saturday morning works')), 'Poll captures latest reply');

  // 4. Privacy & Authorization Protection
  console.log('\n--- 4. Privacy & Authorization Protection ---');
  // Eve attempts to inspect this conversation
  const eveConvRes = await jsonGet(`/api/conversations/${conv.id}`, eveCookie);
  log(eveConvRes.status === 403, 'Unauthorized third party Eve is rejected from conversation with HTTP 403');

  // Eve attempts to read messages
  const eveMsgRes = await jsonGet(`/api/conversations/${conv.id}/messages`, eveCookie);
  log(eveMsgRes.status === 403, 'Unauthorized Eve rejected from reading messages (HTTP 403)');

  // Eve attempts to inject message
  const eveSendRes = await jsonPost(`/api/conversations/${conv.id}/messages`, {
    body: 'Injected message from outsider'
  }, eveCookie);
  log(eveSendRes.status === 403, 'Unauthorized Eve rejected from sending message (HTTP 403)');

  // Anonymous user rejected
  const anonConvRes = await jsonGet(`/api/conversations/${conv.id}`);
  log(anonConvRes.status === 401, 'Anonymous user rejected from conversation (HTTP 401)');

  // 5. Duplicate Prevention & Listing Linkage
  console.log('\n--- 5. Idempotent Thread Lookup ---');
  // Buyer re-opens conversation for same listing
  const reopenRes = await jsonPost('/api/conversations', {
    listing_id: listingId
  }, buyerCookie);
  log(reopenRes.status === 201, 'Re-opening returns existing conversation (HTTP 201)');
  log(reopenRes.body.conversation.id === conv.id, 'Reuses identical conversation ID (no duplicates)');

  // 6. Negotiation Offer Event Synchronization
  console.log('\n--- 6. Negotiation Offer Synchronization ---');
  // Seller creates a formal negotiation
  const negRes = await jsonPost('/api/negotiations', {
    listing_id: listingId,
    buyer_id: buyerUser.id,
    price_per_kg: 21.00,
    quantity_kg: 85
  }, sellerCookie);
  log(negRes.status === 201, 'Seller creates negotiation offer (HTTP 201)');

  // Verify that an OFFER_EVENT message was synchronized into the chat history
  const convAfterNeg = await jsonGet(`/api/conversations/${conv.id}/messages`, buyerCookie);
  log(
    convAfterNeg.body.messages.some(m => m.message_type === 'OFFER_EVENT' && m.body.includes('21.00')),
    'Negotiation offer automatically recorded in chat message history'
  );

  console.log('\n===================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('===================================================================\n');

  return failed;
}

async function main() {
  const express = require('express');
  const originalListen = express.application.listen;

  let serverRef;
  const ready = new Promise((resolve) => {
    express.application.listen = function (...args) {
      serverRef = originalListen.call(this, 0, () => {
        const addr = serverRef.address();
        BASE = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
      return serverRef;
    };
  });

  require('./server');
  await ready;
  express.application.listen = originalListen;

  let failures;
  try {
    failures = await runAllTests();
  } catch (err) {
    console.error('Test runner crashed:', err);
    failures = 1;
  }

  if (serverRef) serverRef.close();
  process.exit(failures > 0 ? 1 : 0);
}

main();

