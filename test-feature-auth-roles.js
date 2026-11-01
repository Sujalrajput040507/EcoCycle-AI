/**
 * EcoCycle AI — Feature 1: Separate Buyer and Seller Accounts & Dashboards Test Suite
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

function jsonPut(urlPath, obj, cookie = '', headers = {}) {
  return request(
    'PUT',
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
  console.log('   EcoCycle AI — Feature 1: Roles & Role-Based Dashboards Suite    ');
  console.log('===================================================================');

  // Reset database
  await jsonPost('/api/reset?users=true', {});

  // --- 1. Seller Registration with Rich Fields ---
  console.log('\n--- 1. Seller Registration & Profile ---');
  const sellerReg = await jsonPost('/api/auth/register', {
    name: 'Green Delhi Scrap Yard',
    email: 'seller@greendelhi.com',
    password: 'password-passphrase-seller-15chars',
    role: 'SELLER',
    phone: '+91 98765 43210',
    user_type: 'Scrap Dealer',
    city: 'Delhi',
    state: 'Delhi',
    address: 'Plot 44, Okhla Industrial Area Phase II',
    category: 'Commercial Collection Hub'
  });

  log(sellerReg.status === 201, 'Seller registered successfully (HTTP 201)');
  log(sellerReg.body.user.role === 'SELLER', 'User role assigned as SELLER');
  log(sellerReg.body.user.phone === '+91 98765 43210', 'Preserves seller phone');
  log(sellerReg.body.user.user_type === 'Scrap Dealer', 'Preserves seller user type');
  log(sellerReg.body.user.city === 'Delhi', 'Preserves seller city');
  log(sellerReg.body.user.address.includes('Okhla'), 'Preserves seller pickup address');
  const sellerCookie = extractCookie(sellerReg.setCookie);
  log(Boolean(sellerCookie), 'Seller receives session cookie');

  // --- 2. Buyer Registration with Purchasing Capacity ---
  console.log('\n--- 2. Buyer Registration & Profile ---');
  const buyerReg = await jsonPost('/api/auth/register', {
    name: 'North Recyclers Corp',
    email: 'buyer@northrecyclers.com',
    password: 'password-passphrase-buyer-15chars',
    role: 'BUYER',
    phone: '+91 91234 56789',
    user_type: 'Flake Processor',
    city: 'Noida',
    state: 'Uttar Pradesh',
    preferred_materials: 'PET Plastic, Clear Flakes',
    purchasing_capacity: 5000,
    collection_radius: 50
  });

  log(buyerReg.status === 201, 'Buyer registered successfully (HTTP 201)');
  log(buyerReg.body.user.role === 'BUYER', 'User role assigned as BUYER');
  log(buyerReg.body.user.purchasing_capacity === 5000, 'Preserves numeric purchasing capacity');
  log(buyerReg.body.user.collection_radius === 50, 'Preserves numeric collection radius');
  const buyerCookie = extractCookie(buyerReg.setCookie);
  log(Boolean(buyerCookie), 'Buyer receives session cookie');

  // --- 3. Role-Based Dashboard Protection ---
  console.log('\n--- 3. Role-Based Dashboard Protection ---');
  // Seller accesses Seller Dashboard -> 200
  const sellerDash = await jsonGet('/api/dashboard/seller', sellerCookie);
  log(sellerDash.status === 200, 'Seller accesses Seller Dashboard (HTTP 200)');
  log(sellerDash.body.role === 'SELLER', 'Dashboard confirms SELLER role');
  log(typeof sellerDash.body.stats.total_listings === 'number', 'Includes total_listings stat');
  log(typeof sellerDash.body.stats.estimated_transaction_value === 'number', 'Includes estimated_transaction_value stat');

  // Buyer tries to access Seller Dashboard -> 403 Forbidden
  const buyerOnSellerDash = await jsonGet('/api/dashboard/seller', buyerCookie);
  log(buyerOnSellerDash.status === 403, 'Buyer is rejected from Seller Dashboard with HTTP 403');
  log(buyerOnSellerDash.body.error.code === 'FORBIDDEN_ROLE', 'Returns FORBIDDEN_ROLE error code');

  // Buyer accesses Buyer Dashboard -> 200
  const buyerDash = await jsonGet('/api/dashboard/buyer', buyerCookie);
  log(buyerDash.status === 200, 'Buyer accesses Buyer Dashboard (HTTP 200)');
  log(buyerDash.body.role === 'BUYER', 'Dashboard confirms BUYER role');
  log(Array.isArray(buyerDash.body.available_categories), 'Includes available categories');
  log(typeof buyerDash.body.stats.recommended_listings_count === 'number', 'Includes recommended_listings_count');

  // Seller tries to access Buyer Dashboard -> 403 Forbidden
  const sellerOnBuyerDash = await jsonGet('/api/dashboard/buyer', sellerCookie);
  log(sellerOnBuyerDash.status === 403, 'Seller is rejected from Buyer Dashboard with HTTP 403');

  // Unauthenticated user rejected from dashboards -> 401
  const anonDash = await jsonGet('/api/dashboard/seller');
  log(anonDash.status === 401, 'Anonymous user rejected from dashboard with HTTP 401');

  // --- 4. Profile Settings Update ---
  console.log('\n--- 4. Profile Update ---');
  const updateRes = await jsonPut('/api/auth/profile', {
    name: 'Green Delhi Scrap Yard (Pvt Ltd)',
    city: 'South Delhi'
  }, sellerCookie);

  log(updateRes.status === 200, 'Profile update returns HTTP 200');
  log(updateRes.body.profile.name === 'Green Delhi Scrap Yard (Pvt Ltd)', 'Updated name saved');
  log(updateRes.body.profile.city === 'South Delhi', 'Updated city saved');

  // --- 5. Forgot Password & Secure Reset Flow ---
  console.log('\n--- 5. Password Recovery Flow ---');
  const forgotRes = await jsonPost('/api/auth/forgot-password', {
    email: 'seller@greendelhi.com'
  });
  log(forgotRes.status === 200, 'Forgot password request returns HTTP 200');
  log(Boolean(forgotRes.body.reset_token), 'Generates secure reset token');

  const resetRes = await jsonPost('/api/auth/reset-password', {
    token: forgotRes.body.reset_token,
    new_password: 'new-secure-passphrase-15chars-long'
  });
  log(resetRes.status === 200, 'Password reset completes with HTTP 200');

  // Verify login with new password
  const newLoginRes = await jsonPost('/api/auth/login', {
    email: 'seller@greendelhi.com',
    password: 'new-secure-passphrase-15chars-long'
  });
  log(newLoginRes.status === 200, 'Login with new password succeeds (HTTP 200)');

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
