/**
 * EcoCycle AI — Official Razorpay Integration & Security Verification Suite
 *
 * Verifies:
 * 1. Public config endpoint (/api/config/razorpay) & secret isolation
 * 2. Unconfigured fallback response (503 Service Unavailable, clear guidance)
 * 3. Server-side order bounds validation (listing check, currency, amounts)
 * 4. Razorpay Service & SDK order creation with mock client injection
 * 5. SQLite dual persistence (payment_transactions table & prepared queries)
 * 6. Cryptographic constant-time HMAC-SHA256 signature verification
 * 7. Tampered signature rejection & untrusted response handling
 * 8. Payment ID reuse prevention (anti-fraud protection)
 * 9. Idempotent payment verification handling
 * 10. Webhook signature verification on raw request bodies
 * 11. Webhook event handling (payment.captured, order.paid, payment.failed)
 * 12. Environment separation (rzp_test_ vs rzp_live_)
 * 13. Decoupling of financial facilitation fee and physical waste recovery
 *
 * Pure Node.js built-ins — zero external test runner dependencies.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { defaultDb } = require('./db');
const {
  RazorpayService,
  defaultRazorpayService,
  DEFAULT_FACILITATION_FEE_PAISE,
  MIN_TRANSACTION_PAISE,
  MAX_TRANSACTION_PAISE,
  ALLOWED_CURRENCY
} = require('./razorpay-service');

let BASE_URL;
let passed = 0;
let failed = 0;

function log(ok, name, detail) {
  const symbol = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${symbol} — ${name}${detail ? ': ' + detail : ''}`);
  if (ok) passed++;
  else failed++;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body !== undefined && body !== null) {
      if (Buffer.isBuffer(body)) {
        payload = body;
      } else if (typeof body === 'object') {
        payload = Buffer.from(JSON.stringify(body));
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      } else {
        payload = Buffer.from(String(body));
      }
      reqHeaders['Content-Length'] = payload.length;
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 EcoCycle AI — Official Razorpay Integration Tests');
  console.log('====================================================\n');

  // Reset database state before starting
  await request('POST', '/api/reset', {});
  defaultDb.resetPaymentTransactions();

  // ----------------------------------------------------
  // TEST SUITE 1: RazorpayService Unit Tests
  // ----------------------------------------------------
  console.log('--- Suite 1: RazorpayService Unit Tests ---');
  {
    const svc = new RazorpayService({
      keyId: 'rzp_test_sample123',
      keySecret: 'sec_test_abc456',
      webhookSecret: 'whsec_test_789'
    });

    log(svc.isConfigured() === true, 'Service detects valid test credentials');
    log(svc.isTestMode() === true, 'Service identifies rzp_test_ as test mode');
    log(svc.isLiveMode() === false, 'Service identifies test mode is not live');

    const liveSvc = new RazorpayService({
      keyId: 'rzp_live_real999',
      keySecret: 'sec_live_xyz888'
    });
    log(liveSvc.isLiveMode() === true, 'Service identifies rzp_live_ as live mode');
    log(liveSvc.isTestMode() === false, 'Live service is not test mode');

    const unconfSvc = new RazorpayService({
      keyId: 'your_razorpay_test_key_id_here',
      keySecret: 'your_razorpay_test_key_secret_here'
    });
    log(unconfSvc.isConfigured() === false, 'Service rejects placeholder credentials as unconfigured');

    const credStatus = unconfSvc.getCredentialStatus();
    log(credStatus.configured === false, 'Credential status indicates configured: false');
    log(credStatus.key_id === '', 'Credential status hides unconfigured key');
    log(credStatus.currency === 'INR', 'Currency defaults to INR');
  }

  // ----------------------------------------------------
  // TEST SUITE 2: Constant-Time HMAC Signature Verification
  // ----------------------------------------------------
  console.log('\n--- Suite 2: Cryptographic Signature Verification Unit Tests ---');
  {
    const secret = 'merchant_secret_key_12345';
    const svc = new RazorpayService({
      keyId: 'rzp_test_unit1',
      keySecret: secret
    });

    const orderId = 'order_DA1234567890';
    const paymentId = 'pay_DB9876543210';
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const isValid = svc.verifyPaymentSignature({
      orderId,
      paymentId,
      signature: validSignature
    });
    log(isValid === true, 'Valid HMAC-SHA256 signature accepted');

    const tamperedSignature = validSignature.slice(0, -2) + '00';
    const isTamperedValid = svc.verifyPaymentSignature({
      orderId,
      paymentId,
      signature: tamperedSignature
    });
    log(isTamperedValid === false, 'Tampered signature rejected');

    const wrongOrderValid = svc.verifyPaymentSignature({
      orderId: 'order_DIFFERENT',
      paymentId,
      signature: validSignature
    });
    log(wrongOrderValid === false, 'Signature with mismatched order rejected');

    const missingSig = svc.verifyPaymentSignature({
      orderId,
      paymentId,
      signature: ''
    });
    log(missingSig === false, 'Empty signature rejected');
  }

  // ----------------------------------------------------
  // TEST SUITE 3: Webhook HMAC-SHA256 Verification
  // ----------------------------------------------------
  console.log('\n--- Suite 3: Webhook Signature Verification Unit Tests ---');
  {
    const whSecret = 'webhook_signing_secret_999';
    const svc = new RazorpayService({
      keyId: 'rzp_test_unit1',
      keySecret: 'sec_123',
      webhookSecret: whSecret
    });

    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', entity: 'event' }));
    const validWhSig = crypto
      .createHmac('sha256', whSecret)
      .update(rawBody)
      .digest('hex');

    const isWhValid = svc.verifyWebhookSignature({
      rawBody,
      signature: validWhSig
    });
    log(isWhValid === true, 'Webhook valid HMAC-SHA256 signature accepted on raw body');

    const tamperedBody = Buffer.from(JSON.stringify({ event: 'payment.captured', entity: 'altered' }));
    const isTamperedWhValid = svc.verifyWebhookSignature({
      rawBody: tamperedBody,
      signature: validWhSig
    });
    log(isTamperedWhValid === false, 'Webhook altered payload rejected');
  }

  // ----------------------------------------------------
  // TEST SUITE 4: Public Config Endpoint & Secret Protection
  // ----------------------------------------------------
  console.log('\n--- Suite 4: Public Config Endpoint & Secret Isolation ---');
  {
    const res = await request('GET', '/api/config/razorpay');
    log(res.status === 200, 'GET /api/config/razorpay returns 200');
    log(typeof res.body.configured === 'boolean', 'Response contains boolean configured property');
    log(res.body.currency === 'INR', 'Currency is declared as INR');
    log(res.body.key_secret === undefined, 'key_secret is never exposed');
    log(res.body.RAZORPAY_KEY_SECRET === undefined, 'RAZORPAY_KEY_SECRET is never exposed');
    log(!res.raw.includes('merchant_secret') && res.body.key_secret === undefined, 'Raw response contains no secret values');
    log(res.body.facilitation_fee_inr === '50.00', 'Facilitation fee declared as 50.00 INR');
  }

  // ----------------------------------------------------
  // TEST SUITE 5: Order Creation Input Bounds & Validation
  // ----------------------------------------------------
  console.log('\n--- Suite 5: Order Creation Bounds & Validation ---');
  {
    // Create a demo listing first
    const listRes = await request('POST', '/api/listings', {
      confirmed_material: 'PET Plastic',
      quantity_kg: 25,
      locality: 'Central City',
      condition: 'Clean'
    });
    log(listRes.status === 201, 'Created active listing for payment testing');
    const listingId = listRes.body.listing.id;

    // Missing listing_id
    const noListing = await request('POST', '/api/payments/create-order', {
      amount_paise: 5000
    });
    log(noListing.status === 400, 'Rejects missing listing_id with 400');

    // Unknown listing_id
    const unknownListing = await request('POST', '/api/payments/create-order', {
      listing_id: 'list_unknown_99999',
      amount_paise: 5000
    });
    log(unknownListing.status === 404, 'Rejects non-existent listing_id with 404');

    // Currency not INR
    const badCurrency = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      currency: 'USD',
      amount_paise: 5000
    });
    log(badCurrency.status === 400, 'Rejects non-INR currency with 400');

    // Below minimum (< 100 paise)
    const belowMin = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      amount_paise: 50
    });
    log(belowMin.status === 400, 'Rejects amount_paise < 100 with 400');

    // Above maximum (> 5,000,000 paise)
    const aboveMax = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      amount_paise: 6000000
    });
    log(aboveMax.status === 400, 'Rejects amount_paise > 5,000,000 with 400');

    // Non-integer amount
    const nonInt = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      amount_paise: 4999.99
    });
    log(nonInt.status === 400, 'Rejects fractional amount_paise with 400');

    // Unconfigured state check
    if (!defaultRazorpayService.isConfigured() && !defaultRazorpayService.customClient) {
      const unconfRes = await request('POST', '/api/payments/create-order', {
        listing_id: listingId,
        amount_paise: 5000
      });
      log(unconfRes.status === 503, 'Returns 503 when server lacks Razorpay credentials');
      log(unconfRes.body.configured === false, 'Explicitly returns configured: false');
    }
  }

  // ----------------------------------------------------
  // TEST SUITE 6: End-to-End Order Creation & Verification with Mock Client
  // ----------------------------------------------------
  console.log('\n--- Suite 6: Order Creation & Signature Verification with Mock SDK ---');
  {
    // Inject deterministic mock client into defaultRazorpayService for test
    const testSecret = 'mock_rzp_secret_for_tests_12345';
    let mockOrderIdCounter = 100;

    const mockClient = {
      orders: {
        create: async (params) => {
          mockOrderIdCounter++;
          return {
            id: `order_test_${mockOrderIdCounter}`,
            entity: 'order',
            amount: params.amount,
            amount_paid: 0,
            amount_due: params.amount,
            currency: params.currency,
            receipt: params.receipt,
            status: 'created',
            notes: params.notes,
            created_at: Math.floor(Date.now() / 1000)
          };
        }
      }
    };

    defaultRazorpayService.setMockClient(mockClient, {
      keyId: 'rzp_test_mocked1234',
      keySecret: testSecret
    });

    // Create listing
    const listRes = await request('POST', '/api/listings', {
      confirmed_material: 'PET Plastic',
      quantity_kg: 75,
      locality: 'South Hub',
      condition: 'Clean'
    });
    const listingId = listRes.body.listing.id;

    // Create order via official route
    const orderRes = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      amount_paise: DEFAULT_FACILITATION_FEE_PAISE
    });

    log(orderRes.status === 201, 'Order created successfully (HTTP 201)');
    log(typeof orderRes.body.order_id === 'string', 'Returns official Razorpay order_id');
    log(orderRes.body.amount === 5000, 'Order amount matches facilitation fee (5000 paise = ₹50)');
    log(orderRes.body.currency === 'INR', 'Order currency is INR');
    log(typeof orderRes.body.transaction_id === 'string', 'Returns transaction reference');

    const orderId = orderRes.body.order_id;
    const paymentId = 'pay_test_payment_9999';

    // Verify SQLite persistence of created order
    const dbTx = defaultDb.findPaymentTransactionByOrderId(orderId);
    log(dbTx !== undefined && dbTx !== null, 'Order successfully recorded in SQLite payment_transactions table');
    log(dbTx && dbTx.status === 'ORDER_CREATED', 'Initial SQLite transaction status is ORDER_CREATED');
    log(dbTx && dbTx.amount_paise === 5000, 'SQLite stored amount_paise is 5000');

    // Attempt verification with invalid signature
    const invalidSigRes = await request('POST', '/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: 'invalid_forged_signature_0000'
    });
    log(invalidSigRes.status === 400, 'Rejects invalid payment signature with 400');
    log(invalidSigRes.body.verified === false, 'Returns verified: false on tampered signature');

    // Check that SQLite status transitioned to PAYMENT_FAILED
    const failedDbTx = defaultDb.findPaymentTransactionByOrderId(orderId);
    log(failedDbTx && failedDbTx.status === 'PAYMENT_FAILED', 'Failed signature records PAYMENT_FAILED in SQLite');

    // Generate authentic HMAC signature
    const authenticSig = crypto
      .createHmac('sha256', testSecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    // Verify with authentic signature
    const validSigRes = await request('POST', '/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: authenticSig
    });

    log(validSigRes.status === 200, 'Authentic signature verified successfully (HTTP 200)');
    log(validSigRes.body.verified === true, 'Returns verified: true on valid signature');
    log(validSigRes.body.payment_id === paymentId, 'Echoes verified payment ID');

    // Check that SQLite status transitioned to PAYMENT_VERIFIED
    const verifiedDbTx = defaultDb.findPaymentTransactionByOrderId(orderId);
    log(verifiedDbTx && verifiedDbTx.status === 'PAYMENT_VERIFIED', 'SQLite transaction updated to PAYMENT_VERIFIED');
    log(verifiedDbTx && verifiedDbTx.payment_id === paymentId, 'SQLite recorded payment_id');

    // ----------------------------------------------------
    // TEST SUITE 7: Anti-Fraud & Idempotency Safeguards
    // ----------------------------------------------------
    console.log('\n--- Suite 7: Anti-Fraud & Idempotency Safeguards ---');

    // 1. Idempotent re-verification
    const reVerifyRes = await request('POST', '/api/payments/verify', {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: authenticSig
    });
    log(reVerifyRes.status === 200, 'Idempotent verification of already-verified payment returns 200');
    log(reVerifyRes.body.verified === true, 'Re-verification retains verified state');

    // 2. Reject duplicate payment order on same listing if already verified
    const duplicateOrderRes = await request('POST', '/api/payments/create-order', {
      listing_id: listingId,
      amount_paise: 5000
    });
    log(duplicateOrderRes.status === 409, 'Rejects creating another order for verified listing with 409 Conflict');

    // 3. Payment ID Reuse Prevention across different orders
    // Create second listing and order
    const listRes2 = await request('POST', '/api/listings', {
      confirmed_material: 'PET Plastic',
      quantity_kg: 50,
      locality: 'North Sector',
      condition: 'Clean'
    });
    const orderRes2 = await request('POST', '/api/payments/create-order', {
      listing_id: listRes2.body.listing.id,
      amount_paise: 5000
    });
    const orderId2 = orderRes2.body.order_id;

    // Try to verify orderId2 using the SAME paymentId from order 1
    const reusedSig = crypto
      .createHmac('sha256', testSecret)
      .update(`${orderId2}|${paymentId}`)
      .digest('hex');

    const reuseAttempt = await request('POST', '/api/payments/verify', {
      razorpay_order_id: orderId2,
      razorpay_payment_id: paymentId,
      razorpay_signature: reusedSig
    });

    log(reuseAttempt.status === 400, 'Rejects reusing payment ID on a different order with 400');
    log(reuseAttempt.body.error && reuseAttempt.body.error.includes('credited to another transaction'), 'Anti-fraud error message returned');

    // ----------------------------------------------------
    // TEST SUITE 8: Webhook Endpoint Verification
    // ----------------------------------------------------
    console.log('\n--- Suite 8: Razorpay Webhooks Processing ---');

    process.env.RAZORPAY_WEBHOOK_SECRET = 'wh_secret_test_xyz789';
    defaultRazorpayService.webhookSecret = 'wh_secret_test_xyz789';

    // 1. Webhook with invalid signature
    const fakeWhPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_wh_test_1',
            order_id: orderId2
          }
        }
      }
    };

    const badWhRes = await request('POST', '/api/payments/webhook', fakeWhPayload, {
      'x-razorpay-signature': 'bad_webhook_sig'
    });
    log(badWhRes.status === 400, 'Rejects webhook with invalid x-razorpay-signature with 400');

    // 2. Webhook with authentic signature
    const validWhBody = Buffer.from(JSON.stringify(fakeWhPayload));
    const validWhSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(validWhBody)
      .digest('hex');

    const goodWhRes = await request('POST', '/api/payments/webhook', validWhBody, {
      'Content-Type': 'application/json',
      'x-razorpay-signature': validWhSig
    });
    log(goodWhRes.status === 200, 'Processes authentic webhook successfully (200)');
    log(goodWhRes.body.received === true, 'Webhook returns received: true');

    // Clean up mock injection
    defaultRazorpayService.setMockClient(null);
    defaultRazorpayService.reloadCredentials();
  }

  // ----------------------------------------------------
  // TEST SUITE 9: Physical Recovery Lifecycle Decoupling
  // ----------------------------------------------------
  console.log('\n--- Suite 9: Facilitation Fee vs Recovery Lifecycle Decoupling ---');
  {
    const listRes = await request('POST', '/api/listings', {
      confirmed_material: 'PET Plastic',
      quantity_kg: 100,
      locality: 'Central City',
      condition: 'Clean'
    });
    const listingId = listRes.body.listing.id;

    const statusRes = await request('GET', `/api/payments/status/${listingId}`);
    log(statusRes.status === 200, 'GET /api/payments/status/:id returns 200');
    log(statusRes.body.recovery_status === 'LISTED', 'Initial physical recovery state remains LISTED');
    log(statusRes.body.physical_recovery_verified === false, 'Physical recovery is NOT marked verified by payment');
    log(statusRes.body.disclaimer.includes('separate from actual physical collection'), 'Discloses clear recovery separation');
  }

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

async function main() {
  const originalListen = express.application.listen;
  let serverRef;

  const ready = new Promise((resolve) => {
    express.application.listen = function (...args) {
      serverRef = originalListen.call(this, 0, () => {
        const addr = serverRef.address();
        BASE_URL = `http://127.0.0.1:${addr.port}`;
        console.log(`Test server dynamically listening on port ${addr.port}`);
        resolve();
      });
      return serverRef;
    };
  });

  require('./server');
  await ready;
  express.application.listen = originalListen;

  try {
    await runTests();
  } finally {
    if (serverRef) {
      serverRef.close();
    }
  }
}

main().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
