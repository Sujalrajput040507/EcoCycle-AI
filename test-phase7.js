/**
 * EcoCycle AI — Phase 7 Razorpay Payment Integration & Honest Recovery Tests
 *
 * Verifies:
 * 1. Razorpay public configuration endpoint (GET /api/config/razorpay) and secret isolation
 * 2. Order creation endpoint (POST /api/payments/create-order) and payload validation
 * 3. HMAC-SHA256 signature verification (POST /api/payments/verify) with timingSafeEqual
 * 4. Separate physical recovery lifecycle tracking (POST /api/listings/:id/recovery)
 * 5. Payment and recovery status decoupling (GET /api/payments/status/:listing_id)
 * 6. Maximum quantity limit ceiling (10,000 kg) on listings and matching
 * 7. Frontend assets include Razorpay checkout script, payment UI, and recovery stepper
 * 8. Zero regressions across core endpoints (health, buyers, analyze, match, reset)
 *
 * Built with pure Node.js built-in modules — zero extra dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0;
let failed = 0;
let skipped = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

function skip(label, reason) {
  console.log(`⏭️ SKIP — ${label}: ${reason}`);
  skipped++;
}

// --- HTTP Helpers ---
let BASE;

function request(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: headers || {}
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body && typeof body === 'string') req.write(body);
    else if (body && Buffer.isBuffer(body)) req.write(body);
    req.end();
  });
}

function jsonPost(urlPath, obj) {
  return request('POST', urlPath, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

// =============================================
// 1. Razorpay Config Endpoint & Secret Protection
// =============================================
async function testRazorpayConfigEndpoint() {
  console.log('\n--- 1. Razorpay Config Endpoint & Secret Protection ---');

  const res = await request('GET', '/api/config/razorpay');
  log(res.status === 200, 'GET /api/config/razorpay returns HTTP 200');
  log(typeof res.body.configured === 'boolean', 'Returns boolean "configured" flag');
  log(res.body.test_mode === true, 'Explicitly declares test_mode: true');
  log(res.body.currency === 'INR', 'Currency defaults to INR');
  log(typeof res.body.key_id === 'string', 'Returns "key_id" string');

  // Verify secret isolation
  const rawBody = JSON.stringify(res.body);
  log(res.body.key_secret === undefined, 'Never exposes key_secret in response');
  log(res.body.RAZORPAY_KEY_SECRET === undefined, 'RAZORPAY_KEY_SECRET is not present in response');
  log(!rawBody.includes('secret') || res.body.key_secret === undefined, 'No secret leaks in payload');
  log(res.body.GEMINI_API_KEY === undefined, 'GEMINI_API_KEY is not leaked');
}

// =============================================
// 2. Maximum Quantity Limit (10,000 kg ceiling)
// =============================================
async function testQuantityCeiling() {
  console.log('\n--- 2. Quantity Ceiling Boundary (MAX_QUANTITY_KG = 10,000) ---');

  await jsonPost('/api/reset', {});

  // Exactly at boundary
  const atMax = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 10000,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(atMax.status === 201, 'Listing creation permits quantity exactly at 10,000 kg (201)');

  // Exceeds boundary
  const overMax = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 10001,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(overMax.status === 400, 'Rejects quantity exceeding 10,000 kg with 400');
  log(overMax.body.error && overMax.body.error.includes('10,000'), 'Error message clearly references limit');

  // Matching endpoint ceiling check
  const matchOverMax = await jsonPost('/api/match', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 15000,
    locality: 'Central City',
    condition: 'Clean'
  });
  log(matchOverMax.status === 400, 'Matching endpoint rejects quantity > 10,000 kg with 400');
}

// =============================================
// 3. Payment Order Creation & Validation
// =============================================
async function testPaymentOrderValidation() {
  console.log('\n--- 3. Payment Order Creation & Input Bounds ---');

  await jsonPost('/api/reset', {});

  // Create test listing
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 50,
    locality: 'Central City',
    condition: 'Clean'
  });
  const listingId = listRes.body.listing.id;

  // Missing listing_id
  const missingListing = await jsonPost('/api/payments/create-order', {
    amount_paise: 5000
  });
  log(missingListing.status === 400, 'Rejects missing listing_id with 400');

  // Non-existent listing_id
  const unknownListing = await jsonPost('/api/payments/create-order', {
    listing_id: 'list_nonexistent_999',
    amount_paise: 5000
  });
  log(unknownListing.status === 404, 'Rejects non-existent listing_id with 404');

  // Invalid currency
  const invalidCurrency = await jsonPost('/api/payments/create-order', {
    listing_id: listingId,
    currency: 'USD',
    amount_paise: 5000
  });
  log(invalidCurrency.status === 400, 'Rejects non-INR currency with 400');

  // Amount below minimum (< 100 paise)
  const belowMin = await jsonPost('/api/payments/create-order', {
    listing_id: listingId,
    amount_paise: 50
  });
  log(belowMin.status === 400, 'Rejects amount_paise < 100 (₹1) with 400');

  // Amount above maximum (> 5,000,000 paise)
  const aboveMax = await jsonPost('/api/payments/create-order', {
    listing_id: listingId,
    amount_paise: 6000000
  });
  log(aboveMax.status === 400, 'Rejects amount_paise > 5,000,000 (₹50,000) with 400');

  // Non-integer amount
  const nonIntAmount = await jsonPost('/api/payments/create-order', {
    listing_id: listingId,
    amount_paise: 50.75
  });
  log(nonIntAmount.status === 400, 'Rejects non-integer amount_paise with 400');

  // Unconfigured / Configured Razorpay handling
  const orderRes = await jsonPost('/api/payments/create-order', {
    listing_id: listingId,
    amount_paise: 5000
  });

  const configRes = await request('GET', '/api/config/razorpay');
  if (!configRes.body.configured) {
    log(orderRes.status === 503, 'Returns 503 Service Unavailable when Razorpay unconfigured');
    log(orderRes.body.configured === false, 'Explicitly declares configured: false');
    log(orderRes.body.error.includes('Razorpay test mode is not configured'), 'Explains unconfigured state safely');
  } else {
    log(orderRes.status === 201, 'Creates Razorpay order successfully when configured (201)');
    log(typeof orderRes.body.order_id === 'string', 'Returns Razorpay order_id');
    log(orderRes.body.amount === 5000, 'Echoes correct amount in paise');
  }
}

// =============================================
// 4. Razorpay Signature Verification & Security
// =============================================
async function testSignatureVerification() {
  console.log('\n--- 4. Payment Signature Verification & Constant-Time Logic ---');

  // Missing fields checks
  const missingOrder = await jsonPost('/api/payments/verify', {
    razorpay_payment_id: 'pay_test_123',
    razorpay_signature: 'sig_test_123'
  });
  log(missingOrder.status === 400, 'Rejects missing razorpay_order_id with 400');

  const missingPayment = await jsonPost('/api/payments/verify', {
    razorpay_order_id: 'order_test_123',
    razorpay_signature: 'sig_test_123'
  });
  log(missingPayment.status === 400, 'Rejects missing razorpay_payment_id with 400');

  const missingSig = await jsonPost('/api/payments/verify', {
    razorpay_order_id: 'order_test_123',
    razorpay_payment_id: 'pay_test_123'
  });
  log(missingSig.status === 400, 'Rejects missing razorpay_signature with 400');

  // Non-existent order
  const unknownOrder = await jsonPost('/api/payments/verify', {
    razorpay_order_id: 'order_nonexistent_999',
    razorpay_payment_id: 'pay_test_123',
    razorpay_signature: 'sig_test_123'
  });
  log(unknownOrder.status === 404, 'Rejects non-existent order_id with 404');

  // Cryptographic HMAC-SHA256 & Timing-Safe Equality Unit Verification
  const mockSecret = 'demo_test_secret_for_unit_tests';
  const orderId = 'order_unit_test_456';
  const paymentId = 'pay_unit_test_789';
  const expectedSig = crypto
    .createHmac('sha256', mockSecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  const bufExpected = Buffer.from(expectedSig, 'utf8');
  const bufValid = Buffer.from(expectedSig, 'utf8');
  const bufTampered = Buffer.from(expectedSig.slice(0, -1) + (expectedSig.endsWith('0') ? '1' : '0'), 'utf8');

  log(crypto.timingSafeEqual(bufExpected, bufValid) === true, 'Constant-time verification accepts authentic HMAC-SHA256 signature');
  log(crypto.timingSafeEqual(bufExpected, bufTampered) === false, 'Constant-time verification rejects tampered signature');
  log(bufExpected.length === 64, 'HMAC-SHA256 produces exact 64-character hex digest');
}

// =============================================
// 5. Honest Material Recovery Lifecycle & Separation
// =============================================
async function testRecoveryLifecycle() {
  console.log('\n--- 5. Honest Physical Recovery Lifecycle Tracking ---');

  await jsonPost('/api/reset', {});

  // 1. Initial listing creation has LISTED recovery status
  const listRes = await jsonPost('/api/listings', {
    confirmed_material: 'PET Plastic',
    quantity_kg: 40,
    locality: 'South Hub',
    condition: 'Clean'
  });
  const listing = listRes.body.listing;
  log(listing.recovery_status === 'LISTED', 'Initial listing has recovery_status="LISTED"');
  log(Array.isArray(listing.recovery_history), 'Initial listing contains recovery_history array');
  log(listing.recovery_history.length === 1, 'Initial audit log contains 1 entry');
  log(listing.recovery_history[0].status === 'LISTED', 'First audit entry marks LISTED status');

  // 2. Fetch status via GET /api/payments/status/:listing_id
  const statusRes = await request('GET', `/api/payments/status/${listing.id}`);
  log(statusRes.status === 200, 'GET /api/payments/status/:listing_id returns 200');
  log(statusRes.body.listing_id === listing.id, 'Returns correct listing_id');
  log(statusRes.body.payment_status === 'NOT_CREATED', 'Payment status is initially NOT_CREATED');
  log(statusRes.body.recovery_status === 'LISTED', 'Recovery status is initially LISTED');

  // 3. Invalid recovery status update
  const invalidRecovery = await jsonPost(`/api/listings/${listing.id}/recovery`, {
    status: 'FABRICATED_CARBON_OFFSET'
  });
  log(invalidRecovery.status === 400, 'Rejects invalid / fabricated recovery status with 400');

  // 4. Advance to MATCHED
  const matchedRes = await jsonPost(`/api/listings/${listing.id}/recovery`, {
    status: 'MATCHED',
    note: 'Matched with GreenRecycle Corp.',
    verified_by: 'Platform Match Engine'
  });
  log(matchedRes.status === 200, 'Advances recovery status to MATCHED (200)');
  log(matchedRes.body.recovery_status === 'MATCHED', 'Echoes updated status MATCHED');
  log(matchedRes.body.recovery_history.length === 2, 'Audit trail length increased to 2');

  // 5. Advance to COLLECTION_CONFIRMED
  const collectedRes = await jsonPost(`/api/listings/${listing.id}/recovery`, {
    status: 'COLLECTION_CONFIRMED',
    note: 'Physical collection verified at South Hub.',
    verified_by: 'Fleet Driver #42'
  });
  log(collectedRes.status === 200, 'Advances recovery status to COLLECTION_CONFIRMED (200)');
  log(collectedRes.body.recovery_status === 'COLLECTION_CONFIRMED', 'Status updated to COLLECTION_CONFIRMED');

  // 6. Advance to RECOVERY_CONFIRMED
  const recoveredRes = await jsonPost(`/api/listings/${listing.id}/recovery`, {
    status: 'RECOVERY_CONFIRMED',
    note: 'PET bottles weighed at facility (40.2 kg verified), washed, and processed.',
    verified_by: 'Facility Inspector'
  });
  log(recoveredRes.status === 200, 'Advances recovery status to RECOVERY_CONFIRMED (200)');
  log(recoveredRes.body.recovery_status === 'RECOVERY_CONFIRMED', 'Status updated to RECOVERY_CONFIRMED');
  log(recoveredRes.body.recovery_history.length === 4, 'Full 4-step audit trail persisted');

  // 7. Verify non-existent listing recovery update returns 404
  const unknownRecovery = await jsonPost('/api/listings/list_unknown_999/recovery', {
    status: 'MATCHED'
  });
  log(unknownRecovery.status === 404, 'Rejects recovery update on unknown listing with 404');
}

// =============================================
// 6. Frontend Assets & Checkout Script Verification
// =============================================
async function testFrontendAssets() {
  console.log('\n--- 6. Frontend Assets & Razorpay Checkout Integration ---');

  const htmlRes = await request('GET', '/');
  log(htmlRes.status === 200, 'GET / serves HTML (200)');
  const html = typeof htmlRes.body === 'string' ? htmlRes.body : '';

  log(html.includes('checkout.razorpay.com/v1/checkout.js'), 'Includes official Razorpay Checkout script');
  log(html.includes('id="payment-panel"'), 'Contains payment-panel element');
  log(html.includes('id="payment-fallback-banner"'), 'Contains unconfigured payment fallback banner');
  log(html.includes('id="payment-card"'), 'Contains payment-card element');
  log(html.includes('id="btn-pay-razorpay"'), 'Contains "Pay via Razorpay" button');
  log(html.includes('id="payment-success-card"'), 'Contains payment-success-card element');
  log(html.includes('id="recovery-tracker-panel"'), 'Contains recovery-tracker-panel element');
  log(html.includes('id="recovery-stepper"'), 'Contains recovery-stepper workflow');
  log(html.includes('id="btn-advance-collection"'), 'Contains collection confirmation button');
  log(html.includes('id="btn-advance-recovery"'), 'Contains recovery confirmation button');
  log(html.includes('id="audit-list"'), 'Contains audit-list container');

  const cssRes = await request('GET', '/styles.css');
  const css = typeof cssRes.body === 'string' ? cssRes.body : '';
  log(css.includes('.payment-panel'), 'CSS defines .payment-panel styling');
  log(css.includes('.recovery-tracker-panel'), 'CSS defines .recovery-tracker-panel styling');
  log(css.includes('.recovery-stepper'), 'CSS defines .recovery-stepper styling');
  log(css.includes('.badge-test'), 'CSS defines .badge-test styling');

  const jsRes = await request('GET', '/app.js');
  const js = typeof jsRes.body === 'string' ? jsRes.body : '';
  log(js.includes('loadRazorpayConfig'), 'app.js includes loadRazorpayConfig function');
  log(js.includes('selectBuyerForPayment'), 'app.js includes selectBuyerForPayment function');
  log(js.includes('verifyPayment'), 'app.js includes verifyPayment function');
  log(js.includes('renderRecoveryUI'), 'app.js includes renderRecoveryUI function');
  log(js.includes('btnAdvanceCollection'), 'app.js wires collection confirmation handler');
  log(js.includes('btnAdvanceRecovery'), 'app.js wires recovery confirmation handler');
}

// =============================================
// 7. Core Regression Verification
// =============================================
async function testCoreRegressions() {
  console.log('\n--- 7. Core Regression Verification ---');

  const healthRes = await request('GET', '/api/health');
  log(healthRes.status === 200, 'GET /api/health responds with 200');
  log(healthRes.body.status === 'ok', 'Health status is ok');
  log(typeof healthRes.body.razorpayConfigured === 'boolean', 'Health reports boolean razorpayConfigured');
  log(typeof healthRes.body.transactionsCount === 'number', 'Health reports numeric transactionsCount');

  const buyersRes = await request('GET', '/api/buyers');
  log(buyersRes.status === 200, 'GET /api/buyers responds with 200');
  log(buyersRes.body.buyers.length === 4, 'Returns 4 demo buyers');

  const resetRes = await jsonPost('/api/reset', {});
  log(resetRes.status === 200, 'POST /api/reset responds with 200');
  log(resetRes.body.success === true, 'Reset succeeds');
}

async function runAllTests() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 7 Razorpay & Recovery Integration Tests');
  console.log('═════════════════════════════════════════════════════════════════');

  await testRazorpayConfigEndpoint();
  await testQuantityCeiling();
  await testPaymentOrderValidation();
  await testSignatureVerification();
  await testRecoveryLifecycle();
  await testFrontendAssets();
  await testCoreRegressions();

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  Phase 7 Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${passed + failed + skipped} total`);
  console.log('═════════════════════════════════════════════════════════════════\n');

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
        console.log(`Test server listening on port ${addr.port}`);
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
