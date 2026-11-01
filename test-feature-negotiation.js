/**
 * EcoCycle AI — Feature 3: Negotiation & Counteroffer System Test Suite
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

async function runTests() {
  console.log('===================================================================');
  console.log('   EcoCycle AI — Feature 3: Negotiation & Counteroffer Suite     ');
  console.log('===================================================================\n');

  // Reset database state cleanly
  await jsonPost('/api/reset?users=true', {});

  // 1. Setup authenticated users: Alice (Seller) and Bob (Attacker / Other user)
  console.log('--- 1. User Setup & Listing Creation ---');
  const regAlice = await jsonPost('/api/auth/register', {
    name: 'Alice Seller',
    email: 'alice.seller@example.com',
    password: 'password-for-alice-negotiation-2026'
  });
  const aliceCookie = extractCookie(regAlice.setCookie);
  log(regAlice.status === 201 && aliceCookie.length > 0, 'Registered Alice (Seller)');

  const regBob = await jsonPost('/api/auth/register', {
    name: 'Bob Other',
    email: 'bob.other@example.com',
    password: 'password-for-bob-negotiation-2026'
  });
  const bobCookie = extractCookie(regBob.setCookie);
  log(regBob.status === 201 && bobCookie.length > 0, 'Registered Bob (Other User)');

  // Alice creates a private listing
  const listingRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 100,
    locality: 'Central City',
    condition: 'Clean'
  }, aliceCookie);
  log(listingRes.status === 201, 'Alice created private listing', listingRes.body.listing.id);
  const listingId = listingRes.body.listing.id;

  // 2. Negotiation Creation
  console.log('\n--- 2. Negotiation Initialization & Offer Minting ---');
  const negInit = await jsonPost('/api/negotiations', {
    listing_id: listingId,
    buyer_id: 'buyer_pet_01',
    initial_price_per_kg: 16.50,
    message: 'Initial proposal at benchmark rate'
  }, aliceCookie);

  log(negInit.status === 201, 'POST /api/negotiations returns HTTP 201');
  const neg = negInit.body.negotiation;
  const initialOffer = negInit.body.current_offer;

  log(typeof neg.id === 'string' && neg.id.startsWith('neg_'), 'Generates unique negotiation ID', neg.id);
  log(neg.status === 'PENDING', 'Initial negotiation status is PENDING');
  log(initialOffer.proposer_role === 'SELLER', 'Initial proposer role is SELLER');
  log(initialOffer.proposed_price_per_kg === 16.50, 'Initial proposed price is 16.50');
  log(initialOffer.revision_number === 1, 'Initial revision number is 1');
  log(initialOffer.total_amount === 1650.00, 'Calculates decimal-safe total amount: 1650.00');

  // Idempotency: re-calling POST /api/negotiations returns existing negotiation
  const negReInit = await jsonPost('/api/negotiations', {
    listing_id: listingId,
    buyer_id: 'buyer_pet_01'
  }, aliceCookie);
  log(negReInit.status === 200, 'Re-requesting existing negotiation returns HTTP 200 (idempotent)');
  log(negReInit.body.negotiation.id === neg.id, 'Returns matching negotiation ID');

  // 3. Counteroffer Flow & State Transitions
  console.log('\n--- 3. Counteroffer Revision Flow ---');
  // Buyer counteroffers at 15.75
  const counter1 = await jsonPost(`/api/negotiations/${neg.id}/offers`, {
    proposed_price_per_kg: 15.75,
    proposer_role: 'BUYER',
    message: 'Can take entire 100kg bale at 15.75'
  }, aliceCookie);

  log(counter1.status === 201, 'Buyer counteroffer created (HTTP 201)');
  log(counter1.body.negotiation.status === 'COUNTERED', 'Negotiation status updated to COUNTERED');
  log(counter1.body.current_offer.revision_number === 2, 'Revision number incremented to 2');
  log(counter1.body.current_offer.proposer_role === 'BUYER', 'Proposer role is BUYER');
  log(counter1.body.current_offer.total_amount === 1575.00, 'Total amount updated to 1575.00');

  // Check offer history endpoint
  const offersListRes = await jsonGet(`/api/negotiations/${neg.id}/offers`, aliceCookie);
  log(offersListRes.status === 200, 'GET /api/negotiations/:id/offers returns 200');
  log(offersListRes.body.offers.length === 2, 'History preserves both revisions in immutable audit chain');
  log(offersListRes.body.offers[0].status === 'SUPERSEDED', 'Previous offer marked as SUPERSEDED');
  log(offersListRes.body.offers[1].status === 'PENDING', 'Latest counteroffer is PENDING');

  // 4. Authorization & Security Checks
  console.log('\n--- 4. Multi-Tenant Authorization & Acceptance Rules ---');
  // Bob tries to accept Alice's negotiation
  const bobAccept = await jsonPost(`/api/offers/${counter1.body.current_offer.id}/accept`, {}, bobCookie);
  log(bobAccept.status === 403, 'Unauthorized user Bob rejected from accepting Alice negotiation (HTTP 403)');

  // Unauthenticated user rejected
  const anonAccept = await jsonPost(`/api/offers/${counter1.body.current_offer.id}/accept`, {});
  log(anonAccept.status === 401, 'Anonymous user rejected from accepting private negotiation (HTTP 401)');

  // 5. Successful Acceptance & Digital Receipt Trigger
  console.log('\n--- 5. Acceptance & Automatic Receipt Issuance ---');
  const aliceAccept = await jsonPost(`/api/offers/${counter1.body.current_offer.id}/accept`, {}, aliceCookie);
  log(aliceAccept.status === 200, 'Alice successfully accepts Buyer counteroffer (HTTP 200)');
  log(aliceAccept.body.negotiation.status === 'ACCEPTED', 'Negotiation status finalized to ACCEPTED');
  log(aliceAccept.body.current_offer.status === 'ACCEPTED', 'Offer status updated to ACCEPTED');
  
  // Verify receipt automatically minted upon acceptance
  log(aliceAccept.body.receipt !== undefined, 'Acceptance automatically mints Digital Waste Transaction Receipt');
  const receipt = aliceAccept.body.receipt;
  log(typeof receipt.receipt_number === 'string' && receipt.receipt_number.startsWith('RCP-2026-'), 'Receipt number formatted correctly', receipt.receipt_number);
  log(typeof receipt.transaction_id === 'string' && receipt.transaction_id.startsWith('TXN-PET-2026-'), 'Transaction ID formatted correctly', receipt.transaction_id);
  log(receipt.agreed_price_per_kg === 15.75, 'Receipt records agreed unit price: 15.75');
  log(receipt.total_amount === 1575.00, 'Receipt records agreed total amount: 1575.00');

  // 6. Terminal State Guard
  console.log('\n--- 6. Terminal State Immutability Guards ---');
  // Attempting to counter an already accepted negotiation must fail
  const postAcceptCounter = await jsonPost(`/api/negotiations/${neg.id}/offers`, {
    proposed_price_per_kg: 18.00
  }, aliceCookie);
  log(postAcceptCounter.status === 400, 'Cannot counter an already ACCEPTED negotiation (HTTP 400)');

  // Attempting to re-accept must fail
  const reAccept = await jsonPost(`/api/offers/${counter1.body.current_offer.id}/accept`, {}, aliceCookie);
  log(reAccept.status === 400, 'Cannot accept an already ACCEPTED offer (HTTP 400)');

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

