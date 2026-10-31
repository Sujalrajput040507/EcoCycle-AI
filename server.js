'use strict';

/**
 * EcoCycle AI — web server
 *nnhjjhjujhyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyu
 * What this file does:
 * - Serves the homepage, login, dashboard and submission form from public/.
 * - Provides demo authentication (in-memory, clearly labelled).
 * - Accepts a PET waste listing (photo + details).
 * - Validates input; rejects empty or invalid data with clear messages.
 * - Stores listings in memory (they reset when the server restarts).
 * - Ranks fictitious sample recyclers with matching.js (no AI scores).
 *
 * It does not call a vision AI API yet.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const matching = require('./matching');
const buyers = require('./data/buyers.json');

const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_CONDITIONS = ['clean', 'mixed', 'unknown'];
const MATERIAL_CATEGORY = 'PET plastic bottles';

const app = express();
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Listings live in this array while the server is running.
const listings = [];
let nextListingNumber = 1;

const storage = multer.diskStorage({
  destination: function (_req, _file, done) {
    done(null, uploadsDir);
  },
  filename: function (_req, file, done) {
    const safeName = String(file.originalname || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9.\-]+/g, '-');
    done(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: function (_req, file, done) {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      done(null, true);
      return;
    }
    const error = new Error('Please upload a JPEG, PNG, or WebP image.');
    error.statusCode = 400;
    done(error);
  }
});

app.use(express.static(publicDir));
app.use(express.json());

// ── Demo authentication (in-memory, clearly labelled) ──────────────
// These are fictitious demo accounts for the hackathon presentation.
// Admin uses a separate password; selecting a role alone does not grant access.
const DEMO_ACCOUNTS = [
  { id: 'user-1', email: 'user@demo.com', password: 'demo123', role: 'user', name: 'Demo User' },
  { id: 'recycler-1', email: 'recycler@demo.com', password: 'demo123', role: 'recycler', name: 'Demo Recycler' },
  { id: 'admin-1', email: 'admin@demo.com', password: 'admin456', role: 'admin', name: 'Demo Admin' }
];
const sessions = new Map(); // token → user object

function getSessionUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return sessions.get(auth.slice(7)) || null;
}

app.post('/api/auth/login', function (req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const account = DEMO_ACCOUNTS.find(function (a) {
    return a.email === email && a.password === password;
  });
  if (!account) {
    sendError(res, 401, 'Invalid email or password. See demo credentials on the login page.');
    return;
  }
  const token = 'tok-' + account.id + '-' + Date.now();
  const user = { id: account.id, email: account.email, role: account.role, name: account.name };
  sessions.set(token, user);
  res.json({ token: token, user: user });
});

app.get('/api/auth/me', function (req, res) {
  const user = getSessionUser(req);
  if (!user) {
    sendError(res, 401, 'Not logged in.');
    return;
  }
  res.json({ user: user });
});

// ── API routes ─────────────────────────────────────────────────────

app.get('/api/health', function (_req, res) {
  res.json({
    ok: true,
    app: 'EcoCycle AI',
    stage: 'phase-1-ui-redesign'
  });
});

app.get('/api/listings', function (_req, res) {
  res.json({ listings: listings.map(publicListing) });
});

app.post('/api/listings', function (req, res) {
  upload.single('image')(req, res, function (uploadError) {
    if (uploadError) {
      sendError(res, 400, uploadError.message || 'The image could not be uploaded.');
      return;
    }

    try {
      const listing = createListing(req.body || {}, req.file);
      listings.push(listing);
      const matchResult = matching.matchListing(listing, buyers);
      res.status(201).json({
        message: 'Listing saved. Sample recycler matches use your confirmed details.',
        listing: publicListing(listing),
        matches: {
          message: 'Matches use confirmed listing details. All recyclers below are fictitious sample data.',
          ...matchResult
        }
      });
    } catch (error) {
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, function () {});
      }
      sendError(res, error.statusCode || 400, error.message);
    }
  });
});

app.get('/api/listings/:id/matches', function (req, res) {
  const listing = findListing(req.params.id);
  if (!listing) {
    sendError(res, 404, 'No listing was found with that id.');
    return;
  }

  const result = matching.matchListing(listing, buyers);
  res.json({
    message: 'Matches use confirmed listing details. All recyclers below are fictitious sample data.',
    ...result
  });
});

app.get('/api/listings/:id', function (req, res) {
  const listing = findListing(req.params.id);
  if (!listing) {
    sendError(res, 404, 'No listing was found with that id.');
    return;
  }

  res.json({ listing: publicListing(listing) });
});

app.use(function (error, _req, res, _next) {
  sendError(res, error.statusCode || 500, error.message || 'Something went wrong.');
});

app.listen(PORT, function () {
  console.log('EcoCycle AI is running at http://localhost:' + PORT);
});

// ── Helpers ────────────────────────────────────────────────────────

function findListing(listingId) {
  return listings.find(function (item) {
    return item.listingId === listingId;
  });
}

function createListing(body, file) {
  if (!file) {
    throw makeError(400, 'Please add a clear photo of the PET plastic bottles.');
  }

  const materialCategory = String(body.materialCategory || '').trim();
  if (materialCategory !== MATERIAL_CATEGORY) {
    throw makeError(400, 'This first version only accepts PET plastic bottles.');
  }

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw makeError(400, 'Quantity must be a number greater than 0, in kilograms.');
  }

  const locationArea = String(body.locationArea || '').trim();
  if (locationArea.length < 2 || locationArea.length > 80) {
    throw makeError(400, 'Please enter a general area (city or neighbourhood), 2–80 characters.');
  }

  const condition = String(body.condition || '').trim();
  if (!ALLOWED_CONDITIONS.includes(condition)) {
    throw makeError(400, 'Please choose a condition: clean, mixed, or unknown.');
  }

  const description = String(body.description || '').trim();
  if (description.length > 300) {
    throw makeError(400, 'The optional description must be 300 characters or fewer.');
  }

  const now = new Date().toISOString();
  const listingId = 'listing-' + nextListingNumber;
  nextListingNumber += 1;

  return {
    listingId: listingId,
    imageReference: file.filename,
    originalFileName: file.originalname,
    materialCategory: MATERIAL_CATEGORY,
    aiEstimatedMaterial: null,
    quantity: quantity,
    unit: 'kg',
    locationArea: locationArea,
    condition: condition,
    description: description,
    analysisStatus: 'not_requested',
    listingStatus: 'LISTED',
    selectedBuyerId: null,
    createdAt: now,
    updatedAt: now,
    isDemoData: true
  };
}

function publicListing(listing) {
  return {
    listingId: listing.listingId,
    originalFileName: listing.originalFileName,
    materialCategory: listing.materialCategory,
    quantity: listing.quantity,
    unit: listing.unit,
    locationArea: listing.locationArea,
    condition: listing.condition,
    description: listing.description,
    analysisStatus: listing.analysisStatus,
    listingStatus: listing.listingStatus,
    createdAt: listing.createdAt,
    isDemoData: listing.isDemoData
  };
}

function sendError(res, statusCode, message) {
  res.status(statusCode).json({ error: message });
}

function makeError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
