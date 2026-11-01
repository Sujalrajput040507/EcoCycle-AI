/**
 * EcoCycle AI — Feature 1: AI Waste Image Analysis Test Suite
 */

const http = require('http');
const { normalizeGeminiResult } = require('./gemini');

let passed = 0;
let failed = 0;

function log(ok, label, detail) {
  const status = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} — ${label}${detail ? ': ' + detail : ''}`);
  if (ok) passed++; else failed++;
}

let BASE;

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + (url.search || ''),
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
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

function uploadImage(buffer, filename = 'test.png', mimeType = 'image/png') {
  const boundary = '----AiTestBoundary' + Date.now();
  const CRLF = '\r\n';
  const head = Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="waste-image"; filename="${filename}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = Buffer.concat([head, buffer, tail]);

  return request('POST', '/api/analyze', body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('   EcoCycle AI — Feature 1: AI Analysis Test Suite   ');
  console.log('====================================================\n');

  // 1. Unit Tests for normalizeGeminiResult
  console.log('--- 1. normalizeGeminiResult Unit Tests ---');
  
  const rawCleanJson = JSON.stringify({
    material: 'PET Plastic',
    is_pet_bottle: true,
    estimated_bottle_count: 24,
    visible_condition: 'Clean',
    contamination_indicators: ['Bottle caps present'],
    image_quality_limitations: ['Minor backlight glare'],
    confidence: 'high',
    notes: 'Clear PET beverage bottles observed in bundle.',
    warnings: ['Cap removal recommended before baling.'],
    is_rough_estimate: false
  });

  const parsed1 = normalizeGeminiResult(rawCleanJson);
  log(parsed1.material === 'PET Plastic', 'Parses material accurately');
  log(parsed1.is_pet_bottle === true, 'Parses is_pet_bottle correctly');
  log(parsed1.estimated_bottle_count === 24, 'Parses estimated bottle count (24)');
  log(parsed1.visible_condition === 'Clean', 'Normalizes condition: Clean');
  log(parsed1.contamination_indicators.includes('Bottle caps present'), 'Includes contamination indicators');
  log(parsed1.image_quality_limitations.includes('Minor backlight glare'), 'Includes image quality limitations');
  log(parsed1.warnings.length >= 1, 'Includes actionable warnings');
  log(parsed1.is_rough_estimate === true, 'Handles is_rough_estimate flag');

  // Markdown codeblock wrapped JSON
  const markdownWrapped = `\`\`\`json\n${rawCleanJson}\n\`\`\``;
  const parsed2 = normalizeGeminiResult(markdownWrapped);
  log(parsed2.is_pet_bottle === true, 'Strips markdown code fences and parses valid JSON');

  // Rejection on corrupt non-JSON text
  const parsedCorrupt = normalizeGeminiResult('This is non-json garbage response');
  log(parsedCorrupt === null, 'Returns null on unparseable non-JSON text');

  // 2. Integration Tests via POST /api/analyze
  console.log('\n--- 2. POST /api/analyze Endpoint Tests ---');

  const uploadRes = await uploadImage(VALID_PNG);
  log(uploadRes.status === 200, 'POST /api/analyze returns HTTP 200');
  
  const b = uploadRes.body;
  log(b.material === 'PET Plastic', 'Material is PET Plastic');
  log(b.is_pet_bottle === true, 'is_pet_bottle flag is true');
  log(b.estimated_bottle_count === null || typeof b.estimated_bottle_count === 'number', 'Returns estimated_bottle_count (null or number)');
  log(typeof b.visible_condition === 'string', 'Returns visible_condition string');
  log(Array.isArray(b.contamination_indicators), 'Returns contamination_indicators array');
  log(Array.isArray(b.image_quality_limitations), 'Returns image_quality_limitations array');
  log(Array.isArray(b.warnings), 'Returns warnings array');
  log(typeof b.is_rough_estimate === 'boolean', 'Returns is_rough_estimate boolean');
  log(b.fallback_used === true, 'Backwards compatible fallback_used boolean present');
  log(typeof b.note === 'string', 'Backwards compatible note present');
  log(typeof b.confidence === 'string', 'Backwards compatible confidence present');

  // Rejection without file
  const emptyRes = await request('POST', '/api/analyze', '', { 'Content-Type': 'application/json' });
  log(emptyRes.status === 400, 'Rejects analyze request without file (HTTP 400)');

  console.log('\n====================================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

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
