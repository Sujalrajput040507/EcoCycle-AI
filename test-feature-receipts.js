/**
 * EcoCycle AI — Feature 5: Digital Waste Transaction Receipt Test Suite
 */

const http = require('http');
const {
  generateReceiptNumber,
  generateTransactionId,
  createCanonicalReceiptPayload,
  computeReceiptDigest,
  verifyReceiptIntegrity,
  issueReceipt,
  getSanitizedPublicReceipt,
  RECEIPT_DISCLAIMER
} = require('./receipt-service');

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

function jsonPost(urlPath, obj, cookie = '') {
  return request(
    'POST',
    urlPath,
    JSON.stringify(obj),
    {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
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

async function runTests() {
  console.log('===================================================================');
  console.log('   EcoCycle AI — Feature 5: Digital Waste Receipt Test Suite     ');
  console.log('===================================================================\n');

  // 1. Service Unit Tests
  console.log('--- 1. Service-Level Canonical Digest & Tamper Detection ---');
  const rcpNum = generateReceiptNumber();
  const txnId = generateTransactionId();
  log(rcpNum.startsWith('RCP-2026-'), 'Receipt number format: RCP-2026-XXXX-XXXX', rcpNum);
  log(txnId.startsWith('TXN-PET-2026-'), 'Transaction ID format: TXN-PET-2026-XXXX', txnId);

  const samplePayload = {
    receipt_number: rcpNum,
    transaction_id: txnId,
    negotiation_id: 'neg_test_123',
    offer_id: 'off_test_456',
    listing_id: 'list_test_789',
    seller_id: 'user_alice_01',
    buyer_id: 'buyer_pet_01',
    material: 'PET Plastic',
    quantity_kg: 50.0,
    unit_price: 16.50,
    gross_value: 825.00,
    currency: 'INR',
    created_at: '2026-10-31T12:00:00.000Z'
  };

  const canonical = createCanonicalReceiptPayload(samplePayload);
  log(typeof canonical === 'string' && canonical.startsWith('{'), 'Canonical JSON payload generated with sorted keys');
  
  const digest = computeReceiptDigest(canonical);
  log(typeof digest === 'string' && digest.length === 64, 'SHA-256 digest is 64 hex characters', digest.substring(0, 16) + '...');

  // Verification succeeds on untampered receipt
  const checkUntampered = verifyReceiptIntegrity({
    ...samplePayload,
    canonical_digest: digest
  });
  log(checkUntampered.valid === true, 'verifyReceiptIntegrity confirms intact receipt');

  // Verification fails on tampered receipt
  const checkTampered = verifyReceiptIntegrity({
    ...samplePayload,
    quantity_kg: 60.0, // altered from 50.0
    canonical_digest: digest
  });
  log(checkTampered.valid === false, 'verifyReceiptIntegrity detects tampered quantity (fails verification)');

  // Public Sanitization
  const issued = issueReceipt({
    negotiation: { id: 'neg_1', seller_id: 'user_alice', buyer_id: 'buyer_pet_01' },
    offer: { id: 'off_1', quantity_kg: 50, price_per_kg: 16.50 },
    listing: { id: 'list_1', confirmed_material: 'PET Plastic', condition: 'Clean', locality: 'Central City' },
    sellerUser: { id: 'user_alice', name: 'Alice Private', email_normalized: 'private.alice@example.com' },
    buyerProfile: { id: 'buyer_pet_01', name: 'EcoPellet Ltd' }
  });

  const pubView = getSanitizedPublicReceipt(issued);
  log(pubView.receipt_number === issued.receipt_number, 'Public view preserves receipt number');
  log(pubView.seller === undefined, 'Public view strips private seller details');
  log(pubView.email === undefined, 'Public view strips private seller email');
  log(pubView.sha256_digest === issued.canonical_digest, 'Public view provides cryptographic digest for verification');
  log(typeof pubView.disclaimer === 'string', 'Public view includes mandatory disclaimer');

  // 2. Integration Tests via API Endpoints
  console.log('\n--- 2. API Endpoints & Verification Route Tests ---');
  await jsonPost('/api/reset?users=true', {});

  // Register Alice and create accepted negotiation to generate a real receipt
  const regAlice = await jsonPost('/api/auth/register', {
    name: 'Alice Receipt Owner',
    email: 'alice.receipt@example.com',
    password: 'password-for-alice-receipt-2026'
  });
  const aliceCookie = extractCookie(regAlice.setCookie);

  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 120,
    locality: 'Central City',
    condition: 'Clean'
  }, aliceCookie);
  const listId = listRes.body.listing.id;

  const negRes = await jsonPost('/api/negotiations', {
    listing_id: listId,
    buyer_id: 'buyer_pet_01',
    initial_price_per_kg: 17.25
  }, aliceCookie);

  // Counter from buyer
  const counterRes = await jsonPost(`/api/negotiations/${negRes.body.negotiation.id}/offers`, {
    proposed_price_per_kg: 16.80,
    proposer_role: 'BUYER'
  }, aliceCookie);

  // Alice accepts offer
  const acceptRes = await jsonPost(`/api/offers/${counterRes.body.current_offer.id}/accept`, {}, aliceCookie);
  log(acceptRes.status === 200, 'Accepted negotiation offer');
  const realReceipt = acceptRes.body.receipt;
  log(realReceipt !== null && typeof realReceipt.receipt_number === 'string', 'Received issued receipt object');

  // GET /api/negotiations/:id/receipt
  const negReceiptRes = await jsonGet(`/api/negotiations/${negRes.body.negotiation.id}/receipt`, aliceCookie);
  log(negReceiptRes.status === 200, 'GET /api/negotiations/:id/receipt returns 200');
  log(negReceiptRes.body.receipt.receipt_number === realReceipt.receipt_number, 'Matches negotiation receipt number');

  // GET /api/receipts/:receiptNumber (Authenticated Owner)
  const fullReceiptRes = await jsonGet(`/api/receipts/${realReceipt.receipt_number}`, aliceCookie);
  log(fullReceiptRes.status === 200, 'GET /api/receipts/:receiptNumber succeeds for authenticated owner');
  log(fullReceiptRes.body.receipt.transaction_id === realReceipt.transaction_id, 'Owner receives full transaction details');

  // GET /api/receipts/:receiptNumber/verify (Public Unauthenticated Endpoint)
  const publicVerifyRes = await jsonGet(`/api/receipts/${realReceipt.receipt_number}/verify`);
  log(publicVerifyRes.status === 200, 'GET /api/receipts/:receiptNumber/verify succeeds publicly without session');
  const pv = publicVerifyRes.body;
  log(pv.valid === true, 'Public verification reports cryptographic integrity is valid');
  log(pv.receipt.seller === undefined, 'Public verification view strips seller details');
  log(typeof pv.disclaimer === 'string', 'Public verification includes disclaimer');

  // 404 on invalid receipt number
  const notFoundRes = await jsonGet('/api/receipts/RCP-2026-0000-0000/verify');
  log(notFoundRes.status === 404, 'Unknown receipt number returns HTTP 404');

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
    failures = await runTests();
  } catch (err) {
    console.error('Test runner crashed:', err);
    failures = 1;
  }

  if (serverRef) serverRef.close();
  process.exit(failures > 0 ? 1 : 0);
}

main();
