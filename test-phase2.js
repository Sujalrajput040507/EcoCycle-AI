/**
 * EcoCycle AI — Phase 2 Integration Tests
 *
 * Tests the Express app directly using Node's http module against
 * an ephemeral server on port 0. All in one process, no external deps.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

// --- HTTP helpers ---
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

function multipartUpload(urlPath, fieldName, filename, contentType, fileBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----TestBoundary' + Date.now();
    const CRLF = '\r\n';
    const header = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '', ''
    ].join(CRLF);
    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function tinyJpeg() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH' +
    'BwYIDAoMCwsKCwsNCxAQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQME' +
    'BAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
    'FBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAA' +
    'AAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEG' +
    'E1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RF' +
    'RkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKj' +
    'pKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP0' +
    '9fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgEC' +
    'BAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
    'ChYkNOEl8RcYI4Q/RFhHSnJFUrNiU5JjgpcKS/LD/9oADAMBAAIRAxEAPwD9U6KK' +
    'KAP/2Q==',
    'base64'
  );
}

async function runTests() {
  console.log('\n══════════════════════════════════════════');
  console.log('  EcoCycle AI — Phase 2 Integration Tests');
  console.log('══════════════════════════════════════════\n');

  // 1. Health endpoint
  {
    const r = await request('GET', '/api/health');
    log(r.status === 200, 'GET /api/health returns 200');
    log(r.body.status === 'ok', 'Health status is "ok"');
    log(typeof r.body.timestamp === 'string', 'Health includes timestamp');
    log(typeof r.body.buyersLoaded === 'number' && r.body.buyersLoaded > 0,
      'Buyers loaded > 0', `${r.body.buyersLoaded} buyers`);
  }

  // 2. Buyers endpoint
  {
    const r = await request('GET', '/api/buyers');
    log(r.status === 200, 'GET /api/buyers returns 200');
    log(Array.isArray(r.body.buyers) && r.body.buyers.length === 4,
      'Returns 4 demo buyers', `got ${r.body.buyers?.length}`);
    log(r.body.buyers[0].id === 'buyer_pet_01', 'First buyer is buyer_pet_01');
  }

  // 3. Analyze — successful JPEG upload
  {
    const jpeg = tinyJpeg();
    const r = await multipartUpload('/api/analyze', 'waste-image', 'test.jpg', 'image/jpeg', jpeg);
    log(r.status === 200, 'POST /api/analyze with JPEG returns 200');
    log(r.body.material === 'PET Plastic', 'Fallback material is PET Plastic');
    log(r.body.fallback_used === true, 'Response declares fallback_used: true');
    log(typeof r.body.note === 'string' && r.body.note.length > 0, 'Note explains fallback');
    log(typeof r.body.confidence === 'string' && r.body.confidence.includes('Fallback'),
      'Confidence mentions fallback');
  }

  // 4. Analyze — missing image
  {
    const r = await request('POST', '/api/analyze', '', { 'Content-Type': 'application/json' });
    log(r.status === 400, 'POST /api/analyze without image returns 400', `got ${r.status}`);
    log(typeof r.body.error === 'string', 'Returns error message');
  }

  // 5. Analyze — invalid file type
  {
    const textFile = Buffer.from('This is not an image');
    const r = await multipartUpload('/api/analyze', 'waste-image', 'test.txt', 'text/plain', textFile);
    log(r.status === 400, 'POST /api/analyze with text/plain returns 400', `got ${r.status}`);
    log(typeof r.body.error === 'string' && r.body.error.toLowerCase().includes('file type'),
      'Error mentions file type');
  }

  // 6. Analyze — WebP
  {
    const r = await multipartUpload('/api/analyze', 'waste-image', 'test.webp', 'image/webp', tinyJpeg());
    log(r.status === 200, 'POST /api/analyze with WebP returns 200');
  }

  // 7. Analyze — PNG
  {
    const r = await multipartUpload('/api/analyze', 'waste-image', 'test.png', 'image/png', tinyJpeg());
    log(r.status === 200, 'POST /api/analyze with PNG returns 200');
  }

  // 8. Reset
  {
    const r = await request('POST', '/api/reset');
    log(r.status === 200, 'POST /api/reset returns 200');
    log(r.body.success === true, 'Reset reports success: true');
  }

  // 9. Listings — initially empty
  {
    const r = await request('GET', '/api/listings');
    log(r.status === 200, 'GET /api/listings returns 200');
    log(Array.isArray(r.body.listings) && r.body.listings.length === 0, 'Listings empty after reset');
  }

  // 10. Create valid listing
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 25,
      locality: 'North Sector', condition: 'Clean'
    });
    log(r.status === 201, 'POST /api/listings valid listing returns 201', `got ${r.status}`);
    log(r.body.success === true, 'Listing success: true');
    log(typeof r.body.listing.id === 'string' && r.body.listing.id.startsWith('list_'),
      'Listing ID format correct', r.body.listing.id);
    log(r.body.listing.status === 'LISTED', 'Listing status is LISTED');
    log(r.body.listing.quantity_kg === 25, 'Quantity stored correctly');
    log(r.body.listing.locality === 'North Sector', 'Locality stored correctly');
    log(r.body.listing.condition === 'Clean', 'Condition stored correctly');
    log(typeof r.body.listing.created_at === 'string', 'Has created_at timestamp');
  }

  // 11. Second listing
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 7.5,
      locality: 'South Hub', condition: 'Mixed/Labels on'
    });
    log(r.status === 201, 'Second listing created (201)');
    log(r.body.listing.quantity_kg === 7.5, 'Decimal quantity stored correctly');
  }

  // 12. Listings count
  {
    const r = await request('GET', '/api/listings');
    log(r.body.listings.length === 2, 'GET /api/listings returns 2 listings', `got ${r.body.listings.length}`);
  }

  // 13-16. Invalid quantities
  for (const [val, desc] of [[0, 'zero'], [-5, 'negative'], ['abc', 'non-numeric'], ['Infinity', 'Infinity']]) {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: val,
      locality: 'North Sector', condition: 'Clean'
    });
    log(r.status === 400, `Rejects ${desc} quantity_kg`, `got ${r.status}`);
  }

  // 17. Missing material
  {
    const r = await jsonPost('/api/listings', {
      quantity_kg: 10, locality: 'North Sector', condition: 'Clean'
    });
    log(r.status === 400, 'Rejects missing confirmed_material', `got ${r.status}`);
    log(r.body.error.includes('confirmed_material'), 'Error mentions confirmed_material');
  }

  // 18. Invalid material
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'Cardboard', quantity_kg: 10,
      locality: 'North Sector', condition: 'Clean'
    });
    log(r.status === 400, 'Rejects invalid material', `got ${r.status}`);
  }

  // 19. Invalid locality
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 10,
      locality: 'Unknown Zone', condition: 'Clean'
    });
    log(r.status === 400, 'Rejects invalid locality', `got ${r.status}`);
  }

  // 20. Invalid condition
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 10,
      locality: 'North Sector', condition: 'Destroyed'
    });
    log(r.status === 400, 'Rejects invalid condition', `got ${r.status}`);
  }

  // 21-23. Missing individual fields
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', locality: 'North Sector', condition: 'Clean'
    });
    log(r.status === 400, 'Rejects missing quantity_kg', `got ${r.status}`);
  }
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 10, condition: 'Clean'
    });
    log(r.status === 400, 'Rejects missing locality', `got ${r.status}`);
  }
  {
    const r = await jsonPost('/api/listings', {
      confirmed_material: 'PET Plastic', quantity_kg: 10, locality: 'North Sector'
    });
    log(r.status === 400, 'Rejects missing condition', `got ${r.status}`);
  }

  // 24. Invalid requests didn't create extra listings
  {
    const r = await request('GET', '/api/listings');
    log(r.body.listings.length === 2,
      'Invalid requests did not create listings (still 2)', `got ${r.body.listings.length}`);
  }

  // 25. Reset and verify empty
  {
    await request('POST', '/api/reset');
    const r = await request('GET', '/api/listings');
    log(r.body.listings.length === 0, 'Listings empty after final reset');
  }

  // 26. Uploaded files are cleaned up
  {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    let fileCount = 0;
    if (fs.existsSync(uploadsDir)) {
      fileCount = fs.readdirSync(uploadsDir).length;
    }
    log(fileCount === 0, 'No uploaded files retained in uploads/', `found ${fileCount}`);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('══════════════════════════════════════════\n');
  return failed;
}

// --- Main ---
async function main() {
  // We need to prevent server.js from calling app.listen with a fixed port.
  // Instead, we'll read server.js, extract the Express app, and bind on port 0.
  // But server.js doesn't export the app. So we modify app.listen interception.

  const express = require('express');
  const originalListen = express.application.listen;

  let serverRef;
  const ready = new Promise((resolve) => {
    express.application.listen = function (...args) {
      // Bind on random available port
      serverRef = originalListen.call(this, 0, () => {
        const addr = serverRef.address();
        BASE = `http://127.0.0.1:${addr.port}`;
        console.log(`Test server listening on port ${addr.port}`);
        resolve();
      });
      return serverRef;
    };
  });

  // This triggers the require, which calls app.listen
  require('./server');
  await ready;

  // Restore
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
