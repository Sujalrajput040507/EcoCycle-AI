/**
 * EcoCycle AI — 5-Feature Complete End-to-End Integration Test Suite
 *
 * Validates the complete unified user journey across all 5 production features:
 * 1. AI Waste Image Analysis (Gemini Vision with fallback)
 * 2. Smart Buyer Matching With Explainable Factor Reasons
 * 3. Transport Feasibility Evaluation
 * 4. Negotiation & Counteroffer System
 * 5. Digital Waste Transaction Receipt Minting & Public Integrity Verification
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

// Minimal valid PNG buffer
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

function uploadImage(buffer) {
  const boundary = '----IntegrationBoundary' + Date.now();
  const CRLF = '\r\n';
  const head = Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="waste-image"; filename="pet_bottles.png"${CRLF}Content-Type: image/png${CRLF}${CRLF}`
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([head, buffer, tail]);

  return request('POST', '/api/analyze', body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  });
}

async function runTests() {
  console.log('===================================================================');
  console.log('   EcoCycle AI — Full 5-Feature Unified End-to-End Suite         ');
  console.log('===================================================================\n');

  // Reset database state
  await jsonPost('/api/reset?users=true', {});

  // Step 1: User Registration
  console.log('--- Step 1: User Onboarding ---');
  const regRes = await jsonPost('/api/auth/register', {
    name: 'Priya Sharma',
    email: 'priya.sharma@example.com',
    password: 'secure-passphrase-for-priya-2026'
  });
  log(regRes.status === 201, 'User Priya Sharma registered successfully');
  const sessionCookie = extractCookie(regRes.setCookie);
  log(sessionCookie.length > 0, 'Authenticated session cookie established');

  // Step 2: Feature 1 - AI Waste Image Analysis
  console.log('\n--- Step 2: Feature 1 — AI Waste Inspection ---');
  const analyzeRes = await uploadImage(VALID_PNG);
  log(analyzeRes.status === 200, 'POST /api/analyze uploaded and inspected waste image');
  const aiData = analyzeRes.body;
  log(aiData.material === 'PET Plastic', 'AI identified material as PET Plastic');
  log(aiData.is_pet_bottle === true, 'AI verified is_pet_bottle: true');
  log(Array.isArray(aiData.contamination_indicators), 'AI generated contamination indicators');
  log(Array.isArray(aiData.warnings), 'AI attached safety warnings');
  log(aiData.is_rough_estimate === true, 'AI explicitly labeled result as rough visual estimate');

  // Step 3: Waste Listing Creation with Coordinates
  console.log('\n--- Step 3: Verified Listing Creation ---');
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 85.0,
    locality: 'Central City',
    condition: 'Clean',
    location: {
      latitude: 28.6139,
      longitude: 77.2090,
      formatted_address: 'Connaught Place, Central City, Delhi'
    }
  }, sessionCookie);
  log(listRes.status === 201, 'Waste listing list_... registered with confirmed PET material');
  const listing = listRes.body.listing;
  log(listing.quantity_kg === 85.0, 'Batch volume stored: 85.0 kg');
  log(listing.locality === 'Central City', 'Operational zone: Central City');

  // Step 4: Feature 2 - Smart Buyer Matching With Structured Reasons
  console.log('\n--- Step 4: Feature 2 — Recycler Matching With Explainable Reasons ---');
  const matchRes = await jsonPost('/api/match', {
    listing_id: listing.id,
    confirmed_material: listing.confirmed_material,
    quantity_kg: listing.quantity_kg,
    locality: listing.locality,
    condition: listing.condition
  }, sessionCookie);
  log(matchRes.status === 200, 'POST /api/match returned matching results');
  log(matchRes.body.eligible.length > 0, 'Found compatible recycling partners', `${matchRes.body.eligible.length} eligible`);
  
  const chosenBuyer = matchRes.body.eligible[0];
  log(Array.isArray(chosenBuyer.reasons) && chosenBuyer.reasons.length === 5, 'Selected buyer contains all 5 explainable factors');
  const matFactor = chosenBuyer.reasons.find(r => r.factor === 'MATERIAL');
  log(matFactor.status === 'MATCH', 'Structured Material factor validated as MATCH');
  const qtyFactor = chosenBuyer.reasons.find(r => r.factor === 'QUANTITY');
  log(qtyFactor !== undefined, 'Structured Quantity factor evaluated', qtyFactor.message);

  // Step 5: Feature 4 - Transport Feasibility Checker
  console.log('\n--- Step 5: Feature 4 — Transport Feasibility Evaluation ---');
  const transportRes = await jsonPost('/api/transport/feasibility', {
    buyer_id: chosenBuyer.buyer_id,
    listing_id: listing.id,
    pickup_lat: listing.location.latitude,
    pickup_lng: listing.location.longitude,
    quantity_kg: listing.quantity_kg,
    unit_price: 16.50
  });
  log(transportRes.status === 200, 'POST /api/transport/feasibility returned feasibility evaluation');
  const tf = transportRes.body;
  log(tf.distance_type === 'STRAIGHT_LINE_ESTIMATE', 'Distance attributed honestly as STRAIGHT_LINE_ESTIMATE');
  log(typeof tf.distance_km === 'number' && tf.distance_km >= 0, 'Calculated distance: ' + tf.distance_km + ' km');
  log(typeof tf.estimated_transport_cost === 'number', 'Calculated freight cost: ₹' + tf.estimated_transport_cost);
  log(tf.gross_material_value === 1402.50, 'Computed gross material value: 85kg * ₹16.50 = ₹1402.50');
  log(typeof tf.estimated_net_value === 'number', 'Calculated net value to seller: ₹' + tf.estimated_net_value);
  log(typeof tf.disclaimer === 'string' && tf.disclaimer.length > 20, 'Mandatory transport estimate disclaimer included');

  // Step 6: Feature 3 - Negotiation & Counteroffers
  console.log('\n--- Step 6: Feature 3 — Commercial Negotiation & Counteroffer Loop ---');
  const negInit = await jsonPost('/api/negotiations', {
    listing_id: listing.id,
    buyer_id: chosenBuyer.buyer_id,
    initial_price_per_kg: 17.50,
    message: 'Asking ₹17.50 for high grade clean PET'
  }, sessionCookie);
  log(negInit.status === 201, 'Initiated negotiation neg_... (status PENDING)');
  const negId = negInit.body.negotiation.id;

  // Buyer counteroffers at ₹16.75
  const counterRes = await jsonPost(`/api/negotiations/${negId}/offers`, {
    proposed_price_per_kg: 16.75,
    proposer_role: 'BUYER',
    message: 'Can take entire 85kg batch at ₹16.75 with prompt pickup.'
  }, sessionCookie);
  log(counterRes.status === 201, 'Buyer counteroffer recorded (status COUNTERED)');
  log(counterRes.body.current_offer.revision_number === 2, 'Revision sequence incremented to Revision 2');
  log(counterRes.body.current_offer.total_amount === 1423.75, 'Total commercial value updated to ₹1423.75');

  // Step 7: Feature 5 - Agreement Acceptance & Digital Receipt Minting
  console.log('\n--- Step 7: Feature 5 — Offer Acceptance & Digital Transaction Receipt ---');
  const acceptRes = await jsonPost(`/api/offers/${counterRes.body.current_offer.id}/accept`, {}, sessionCookie);
  log(acceptRes.status === 200, 'Seller Priya accepted buyer offer (status finalized to ACCEPTED)');
  log(acceptRes.body.receipt !== undefined, 'Offer acceptance automatically minted Digital Waste Transaction Receipt');
  
  const receipt = acceptRes.body.receipt;
  log(receipt.receipt_number.startsWith('RCP-2026-'), 'Receipt Number: ' + receipt.receipt_number);
  log(receipt.transaction_id.startsWith('TXN-PET-2026-'), 'Transaction ID: ' + receipt.transaction_id);
  log(typeof receipt.canonical_digest === 'string' && receipt.canonical_digest.length === 64, 'Tamper-evident SHA-256 Digest: ' + receipt.canonical_digest.substring(0, 16) + '...');
  log(receipt.gross_value === 1423.75 || receipt.total_amount === 1423.75, 'Agreed gross value recorded: ₹1423.75');

  // Step 8: Public Receipt Verification
  console.log('\n--- Step 8: Public QR Verification Endpoint ---');
  const verifyRes = await jsonGet(`/api/receipts/${receipt.receipt_number}/verify`);
  log(verifyRes.status === 200, 'Public verify endpoint accessible without credentials');
  log(verifyRes.body.valid === true, 'Public endpoint confirms canonical SHA-256 digest is intact and un-tampered');
  log(verifyRes.body.receipt.seller === undefined, 'Public verification view preserves privacy by stripping personal seller data');
  log(typeof verifyRes.body.disclaimer === 'string', 'Public verification view includes legal disclaimer');

  // Step 9: Link to Physical Recovery Batch
  console.log('\n--- Step 9: Physical Custody Hand-off (EcoProof Loop) ---');
  const batchRes = await jsonPost('/api/batches', {
    listing_id: listing.id
  }, sessionCookie);
  log(batchRes.status === 201, 'Initiated physical EcoProof custody batch', batchRes.body.batch.batch_code);
  log(batchRes.body.batch.batch_code.startsWith('ECO-PET-2026-'), 'Generated EcoProof batch code: ' + batchRes.body.batch.batch_code);

  console.log('\n===================================================================');
  console.log(`Unified Integration Results: ${passed} passed, ${failed} failed.`);
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
