/**
 * EcoCycle AI — Express Server
 * 
 * Serves the static frontend and API endpoints.
 * Keeps AI API keys server-side only.
 * Phase 7: PET recovery platform + secure Razorpay test-mode integration.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  RazorpayService,
  defaultRazorpayService,
  DEFAULT_FACILITATION_FEE_PAISE
} = require('./razorpay-service');
const { analyzeImageWithGemini } = require('./gemini');
const { matchBuyers } = require('./matching');
const {
  estimatePetPrice,
  defaultProvider,
  defaultManager,
  GRADE_SPECS,
  KNOWN_INDIAN_HUBS
} = require('./pet-price-service');
const { defaultDb } = require('./db');
const { defaultAuthService } = require('./auth-service');
const {
  evaluateTransportFeasibility,
  getBuyerFacility,
  TRANSPORT_DISCLAIMER
} = require('./transport-service');
const {
  issueReceipt,
  verifyReceiptIntegrity,
  getSanitizedPublicReceipt,
  RECEIPT_DISCLAIMER
} = require('./receipt-service');
const {
  createSessionMiddleware,
  attachUser,
  requireAuth,
  requireRole,
  requireAnyRole,
  defaultAuthLimiter,
  csrfProtection,
  noCacheAuth
} = require('./auth-middleware');
const {
  EVIDENCE_CATEGORIES,
  CATEGORY_WEIGHTS,
  DEFAULT_DISCREPANCY_THRESHOLD_PERCENT,
  EVIDENCE_DISCLAIMER,
  generateBatchCode,
  sha256,
  recordAuditEvent,
  verifyAuditChain,
  calculateEvidenceScore,
  calculateWeightDiscrepancy,
  sanitizePublicBatchView,
  generateBatchQrDataUrl,
  analyzeEvidenceWithAi
} = require('./ecoproof-service');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Allowed values & limits (single source of truth) ---
const ALLOWED_LOCALITIES = ['North Sector', 'South Hub', 'Central City', 'Industrial East'];
const ALLOWED_CONDITIONS = ['Clean', 'Mixed/Labels on', 'Contaminated/Dirty'];
const ALLOWED_MATERIALS  = ['PET Plastic'];

const MAX_QUANTITY_KG        = 10000;   // 10 metric tons max demo batch limit
const MIN_TRANSACTION_PAISE  = 100;     // ₹1.00 min demo transaction
const MAX_TRANSACTION_PAISE  = 5000000; // ₹50,000.00 max demo test transaction limit

// --- Multer configuration ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
});

// Dedicated secure storage for EcoProof Loop evidence files
const evidenceDir = path.join(__dirname, 'data', 'evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

const evidenceUpload = multer({
  dest: evidenceDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
});

// --- Middleware ---
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(cors());
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(createSessionMiddleware(defaultDb));
app.use(attachUser(defaultAuthService));
app.use(csrfProtection);
app.use(express.static(path.join(__dirname, 'public')));

// --- Load demo buyer data ---
const buyersPath = path.join(__dirname, 'data', 'buyers.json');
let buyers = [];
try {
  buyers = JSON.parse(fs.readFileSync(buyersPath, 'utf-8'));
  console.log(`Loaded ${buyers.length} demo buyer profiles.`);
} catch (err) {
  console.error('Warning: Could not load buyers.json:', err.message);
}

// --- In-memory listings store ---
let listings = [];
let listingCounter = 0;

// --- In-memory payments and transactions store ---
let transactions = [];
let transactionCounter = 0;

// --- Helper: generate listing ID ---
function generateListingId() {
  listingCounter += 1;
  return `list_${Date.now()}_${listingCounter}`;
}

// --- Helper: generate transaction ID ---
function generateTransactionId() {
  transactionCounter += 1;
  return `txn_${Date.now()}_${transactionCounter}`;
}

// --- Razorpay helpers ---
function isRazorpayConfigured() {
  return defaultRazorpayService.isConfigured();
}

function getRazorpayInstance() {
  return defaultRazorpayService.getClient();
}

function verifyRazorpaySignature(orderId, paymentId, signature, secret) {
  return defaultRazorpayService.verifyPaymentSignature({
    orderId,
    paymentId,
    signature,
    secretOverride: secret || (process.env.RAZORPAY_KEY_SECRET ? process.env.RAZORPAY_KEY_SECRET.trim() : null)
  });
}

// --- Helper: clean up uploaded file ---
function removeUploadedFile(filePath) {
  if (filePath) {
    fs.unlink(filePath, () => {}); // fire-and-forget
  }
}

// --- Helper: validate actual image magic bytes (JPEG, PNG, WebP) ---
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true;
  // WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}

// =============================================
// API ROUTES
// =============================================

/**
 * GET /api/health
 * Quick check that the backend is running.
 */
app.get('/api/health', (req, res) => {
  const geminiConfigured = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here');
  const mapsConfigured = !!(process.env.GOOGLE_MAPS_BROWSER_KEY && process.env.GOOGLE_MAPS_BROWSER_KEY !== 'your_google_maps_browser_key_here');
  const razorpayConfigured = isRazorpayConfigured();
  res.json({
    status: 'ok',
    service: 'EcoCycle AI',
    focus: 'PET Plastic Recovery Platform',
    timestamp: new Date().toISOString(),
    buyersLoaded: buyers.length,
    listingsCount: listings.length,
    transactionsCount: transactions.length,
    geminiConfigured,
    mapsConfigured,
    razorpayConfigured
  });
});

// =============================================
// AUTHENTICATION ROUTES (Phase 10)
// =============================================

/**
 * POST /api/auth/register
 * Registers a new user with password hashing and session creation.
 */
app.post('/api/auth/register', noCacheAuth, defaultAuthLimiter.middleware('register', 15), async (req, res) => {
  const result = await defaultAuthService.register(req.body || {});
  if (!result.success) {
    return res.status(result.status).json({
      success: false,
      error: { code: result.code, message: result.error }
    });
  }

  // Automatically establish authenticated session upon successful registration
  req.session.userId = result.user.id;
  res.status(201).json({
    success: true,
    user: result.user
  });
});

/**
 * POST /api/auth/login
 * Verifies credentials, regenerates session ID to prevent fixation, and stores user in session.
 */
app.post('/api/auth/login', noCacheAuth, defaultAuthLimiter.middleware('login', 10), async (req, res) => {
  const result = await defaultAuthService.login(req.body || {});
  if (!result.success) {
    return res.status(result.status).json({
      success: false,
      error: { code: result.code, message: result.error }
    });
  }

  // Regenerate session ID to mitigate session fixation attacks
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'SESSION_ERROR', message: 'Could not regenerate authenticated session.' }
      });
    }
    req.session.userId = result.user.id;
    res.json({
      success: true,
      user: result.user
    });
  });
});

/**
 * GET /api/auth/me
 * Returns current authenticated user or 401 UNAUTHENTICATED.
 */
app.get('/api/auth/me', noCacheAuth, (req, res) => {
  if (req.user) {
    return res.json({
      success: true,
      user: req.user
    });
  }
  res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Please sign in to continue.'
    }
  });
});

/**
 * POST /api/auth/logout
 * Destroys server-side session and clears cookie.
 */
app.post('/api/auth/logout', noCacheAuth, (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('ecocycle_sid', { path: '/' });
      res.json({
        success: true,
        message: 'Logged out successfully.'
      });
    });
  } else {
    res.clearCookie('ecocycle_sid', { path: '/' });
    res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  }
});

/**
 * GET /api/auth/profile
 * Returns profile of authenticated user.
 */
app.get('/api/auth/profile', noCacheAuth, requireAuth, (req, res) => {
  res.json({
    success: true,
    profile: req.user
  });
});

/**
 * PUT /api/auth/profile
 * Updates profile settings for the authenticated user.
 */
app.put('/api/auth/profile', noCacheAuth, requireAuth, csrfProtection, async (req, res) => {
  try {
    const allowed = [
      'name', 'phone', 'user_type', 'city', 'state', 'address', 'category',
      'preferred_materials', 'purchasing_capacity', 'collection_radius', 'preferences_json'
    ];
    const updateData = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    }
    const updated = await defaultAuthService.updateProfile(req.user.id, updateData);
    res.json({ success: true, profile: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not update profile.' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Generates password reset token for valid email.
 */
app.post('/api/auth/forgot-password', noCacheAuth, defaultAuthLimiter.middleware('forgot', 5), async (req, res) => {
  const result = await defaultAuthService.forgotPassword(req.body ? req.body.email : '');
  res.status(result.status).json(result);
});

/**
 * POST /api/auth/reset-password
 * Resets password using verified token.
 */
app.post('/api/auth/reset-password', noCacheAuth, defaultAuthLimiter.middleware('reset', 5), async (req, res) => {
  const result = await defaultAuthService.resetPassword(req.body || {});
  res.status(result.status).json(result);
});

// =============================================
// ROLE-BASED DASHBOARD ROUTES (Feature 1)
// =============================================

/**
 * GET /api/dashboard/seller
 * Role-protected dashboard metrics and activity for Sellers.
 */
app.get('/api/dashboard/seller', noCacheAuth, requireAuth, requireRole('SELLER'), (req, res) => {
  const sellerId = req.user.id;
  const userListings = listings.filter(l => l.user_id === sellerId);
  const activeListings = userListings.filter(l => l.recovery_status !== 'RECOVERY_CONFIRMED');

  const userNegotiations = defaultDb.listNegotiationsByUser(sellerId)
    .filter(n => n.seller_id === sellerId);

  const pendingOffers = userNegotiations.filter(n => n.status === 'PENDING' || n.status === 'COUNTERED');
  const acceptedDeals = userNegotiations.filter(n => n.status === 'ACCEPTED');

  const receipts = defaultDb.listReceiptsByUser(sellerId)
    .filter(r => r.seller_id === sellerId);

  const completedTransactions = receipts.filter(r => r.status === 'AGREEMENT_CONFIRMED' || r.payment_status === 'VERIFIED');
  const estimatedTransactionValue = receipts.reduce((acc, r) => acc + (Number(r.gross_value) || 0), 0);

  const unreadMessages = defaultDb.getUnreadMessageCountByUser(sellerId);
  const unreadNotifications = defaultDb.getUnreadNotificationCountByUser(sellerId);

  const counteroffersRequiringAttention = userNegotiations.filter(n => {
    if (n.status !== 'PENDING' && n.status !== 'COUNTERED') return false;
    const latestOffer = defaultDb.getLatestOffer(n.id);
    return latestOffer && latestOffer.offered_by_role === 'BUYER';
  });

  const recentConversations = defaultDb.listConversationsByUser(sellerId).slice(0, 5);

  res.json({
    success: true,
    role: 'SELLER',
    stats: {
      total_listings: userListings.length,
      active_listings: activeListings.length,
      pending_buyer_inquiries: pendingOffers.length,
      unread_messages: unreadMessages,
      unread_notifications: unreadNotifications,
      incoming_offers: pendingOffers.length,
      counteroffers_requiring_attention: counteroffersRequiringAttention.length,
      accepted_deals: acceptedDeals.length,
      completed_transactions: completedTransactions.length,
      estimated_transaction_value: Number(estimatedTransactionValue.toFixed(2))
    },
    listings: userListings.slice(0, 10),
    negotiations: userNegotiations.slice(0, 10),
    incoming_negotiations: pendingOffers,
    receipts: receipts.slice(0, 10),
    conversations: recentConversations
  });
});

/**
 * GET /api/dashboard/buyer
 * Role-protected dashboard metrics and opportunities for Buyers.
 */
app.get('/api/dashboard/buyer', noCacheAuth, requireAuth, requireRole('BUYER'), (req, res) => {
  const buyerId = req.user.id;

  const availableListings = listings.filter(l => l.recovery_status !== 'RECOVERY_CONFIRMED');

  const buyerNegotiations = defaultDb.listNegotiationsByUser(buyerId)
    .filter(n => n.buyer_id === buyerId);

  const activeNegotiations = buyerNegotiations.filter(n => n.status === 'PENDING' || n.status === 'COUNTERED');
  const acceptedDeals = buyerNegotiations.filter(n => n.status === 'ACCEPTED');

  const receipts = defaultDb.listReceiptsByUser(buyerId)
    .filter(r => r.buyer_id === buyerId);

  const totalPurchaseValue = receipts.reduce((acc, r) => acc + (Number(r.gross_value) || 0), 0);

  const unreadMessages = defaultDb.getUnreadMessageCountByUser(buyerId);
  const unreadNotifications = defaultDb.getUnreadNotificationCountByUser(buyerId);

  const negotiationsAwaitingResponse = buyerNegotiations.filter(n => {
    if (n.status !== 'PENDING' && n.status !== 'COUNTERED') return false;
    const latestOffer = defaultDb.getLatestOffer(n.id);
    return latestOffer && latestOffer.offered_by_role === 'SELLER';
  });

  const categories = [...new Set(availableListings.map(l => l.confirmed_material || 'PET Plastic'))];
  const recentConversations = defaultDb.listConversationsByUser(buyerId).slice(0, 5);

  res.json({
    success: true,
    role: 'BUYER',
    stats: {
      recommended_listings_count: availableListings.length,
      available_listings: availableListings.length,
      available_categories_count: categories.length,
      active_negotiations_count: activeNegotiations.length,
      unread_messages: unreadMessages,
      unread_notifications: unreadNotifications,
      negotiations_awaiting_response: negotiationsAwaitingResponse.length,
      accepted_deals: acceptedDeals.length,
      completed_purchases: receipts.length,
      total_purchase_value: Number(totalPurchaseValue.toFixed(2))
    },
    available_listings: availableListings.slice(0, 10),
    recommended_listings: availableListings.slice(0, 10),
    available_categories: categories,
    active_negotiations: activeNegotiations.slice(0, 10),
    negotiations: buyerNegotiations.slice(0, 10),
    receipts: receipts.slice(0, 10),
    conversations: recentConversations
  });
});

// =============================================
// IN-PLATFORM MESSAGING & CHAT ROUTES (Feature 2)
// =============================================

/**
 * POST /api/conversations
 * Opens or retrieves a persistent conversation thread for a waste listing.
 */
app.post('/api/conversations', requireAuth, csrfProtection, (req, res) => {
  const { listing_id, initial_message, recipient_id, buyer_id } = req.body || {};

  let targetListing = null;
  if (listing_id) {
    targetListing = listings.find(l => l.id === listing_id);
  }

  let sellerId = null;
  let convBuyerId = null;

  if (targetListing && targetListing.user_id === req.user.id) {
    // Current authenticated user is the seller/owner
    sellerId = req.user.id;
    convBuyerId = recipient_id || buyer_id || 'demo_buyer';
  } else {
    // Current authenticated user is a buyer inquiring or negotiating
    convBuyerId = req.user.id;
    sellerId = targetListing ? (targetListing.user_id || 'demo_seller') : (recipient_id || 'demo_seller');
  }

  // Self-messaging prevention
  if (sellerId === convBuyerId) {
    return res.status(400).json({
      success: false,
      error: 'You cannot open a buyer negotiation thread with yourself.'
    });
  }

  let conversation = null;
  if (listing_id && sellerId && convBuyerId) {
    conversation = defaultDb.findConversationByListingAndBuyer(listing_id, convBuyerId);
  }

  if (!conversation) {
    const convId = `conv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const subject = targetListing
      ? `${targetListing.confirmed_material || 'PET Plastic'} (${targetListing.quantity_kg || 0} kg) - ${targetListing.locality || 'Locality'}`
      : 'Marketplace Inquiry';

    conversation = defaultDb.createConversation({
      id: convId,
      listing_id: listing_id || null,
      seller_id: sellerId,
      buyer_id: convBuyerId,
      subject
    });
  }

  let firstMessage = null;
  if (initial_message && typeof initial_message === 'string' && initial_message.trim().length > 0) {
    const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const cleanBody = initial_message.trim().substring(0, 4000);
    const recipient = req.user.id === conversation.seller_id ? conversation.buyer_id : conversation.seller_id;
    firstMessage = defaultDb.createMessage({
      id: msgId,
      conversation_id: conversation.id,
      sender_id: req.user.id,
      recipient_id: recipient,
      sender_role: req.user.role || 'BUYER',
      body: cleanBody
    });

    defaultDb.createNotification({
      id: `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      user_id: recipient,
      type: 'NEW_MESSAGE',
      title: `New message from ${req.user.name}`,
      body: cleanBody.substring(0, 80),
      link: '#chat-panel'
    });
  }

  res.status(201).json({
    success: true,
    conversation,
    message: firstMessage
  });
});

/**
 * GET /api/conversations
 * Lists all conversations for current authenticated user.
 */
app.get('/api/conversations', requireAuth, (req, res) => {
  const userConversations = defaultDb.listConversationsByUser(req.user.id);
  const enriched = userConversations.map(conv => {
    const otherId = conv.seller_id === req.user.id ? conv.buyer_id : conv.seller_id;
    const otherUser = defaultDb.findUserById(otherId);
    const listing = conv.listing_id ? listings.find(l => l.id === conv.listing_id) : null;
    return {
      ...conv,
      other_party: {
        id: otherId,
        name: otherUser ? otherUser.name : (conv.seller_id === req.user.id ? 'Buyer Partner' : 'Seller Partner'),
        role: otherUser ? otherUser.role : (conv.seller_id === req.user.id ? 'BUYER' : 'SELLER')
      },
      listing: listing ? {
        id: listing.id,
        material: listing.confirmed_material || 'PET Plastic',
        quantity_kg: listing.quantity_kg,
        locality: listing.locality,
        condition: listing.condition
      } : null
    };
  });
  res.json({ success: true, conversations: enriched });
});

/**
 * GET /api/conversations/:id
 * Fetches single conversation and verifies participant authorization.
 */
app.get('/api/conversations/:id', requireAuth, (req, res) => {
  const conv = defaultDb.findConversationById(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  if (conv.seller_id !== req.user.id && conv.buyer_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Unauthorized to view this conversation.' });
  }

  const otherId = conv.seller_id === req.user.id ? conv.buyer_id : conv.seller_id;
  const otherUser = defaultDb.findUserById(otherId);
  const listing = conv.listing_id ? listings.find(l => l.id === conv.listing_id) : null;

  res.json({
    success: true,
    conversation: {
      ...conv,
      other_party: {
        id: otherId,
        name: otherUser ? otherUser.name : (conv.seller_id === req.user.id ? 'Buyer Partner' : 'Seller Partner'),
        role: otherUser ? otherUser.role : (conv.seller_id === req.user.id ? 'BUYER' : 'SELLER')
      },
      listing
    }
  });
});

/**
 * GET /api/conversations/:id/messages
 * Retrieves message history and updates read status.
 */
app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = defaultDb.findConversationById(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  if (conv.seller_id !== req.user.id && conv.buyer_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Unauthorized.' });
  }

  const since = req.query.since || null;
  const messages = defaultDb.listMessagesByConversation(conv.id, since);

  // Automatically mark unread messages directed to this user as read
  defaultDb.markMessagesRead(conv.id, req.user.id);

  res.json({ success: true, messages });
});

/**
 * POST /api/conversations/:id/messages
 * Sends a message in the conversation thread.
 */
app.post('/api/conversations/:id/messages', requireAuth, csrfProtection, (req, res) => {
  const conv = defaultDb.findConversationById(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  if (conv.seller_id !== req.user.id && conv.buyer_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Unauthorized.' });
  }

  const { body, message_type = 'TEXT', metadata_json = null } = req.body || {};
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message body cannot be empty.' });
  }

  const cleanBody = body.trim().substring(0, 4000);
  const recipientId = req.user.id === conv.seller_id ? conv.buyer_id : conv.seller_id;
  const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const message = defaultDb.createMessage({
    id: msgId,
    conversation_id: conv.id,
    sender_id: req.user.id,
    recipient_id: recipientId,
    sender_role: req.user.role || 'SELLER',
    body: cleanBody,
    message_type,
    metadata_json: typeof metadata_json === 'object' ? JSON.stringify(metadata_json) : metadata_json
  });

  defaultDb.createNotification({
    id: `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    user_id: recipientId,
    type: 'NEW_MESSAGE',
    title: `Message from ${req.user.name}`,
    body: cleanBody.substring(0, 80),
    link: '#chat-panel'
  });

  res.status(201).json({ success: true, message });
});

/**
 * Notifications Endpoints
 */
app.get('/api/notifications', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const notifications = defaultDb.listNotificationsByUser(req.user.id, limit);
  const unreadCount = defaultDb.getUnreadNotificationCountByUser(req.user.id);
  res.json({ success: true, notifications, unread_count: unreadCount });
});

app.post('/api/notifications/:id/read', requireAuth, csrfProtection, (req, res) => {
  const updated = defaultDb.markNotificationRead(req.params.id, req.user.id);
  res.json({ success: true, updated });
});

app.post('/api/notifications/read-all', requireAuth, csrfProtection, (req, res) => {
  const notifs = defaultDb.listNotificationsByUser(req.user.id, 100);
  for (const n of notifs) {
    defaultDb.markNotificationRead(n.id, req.user.id);
  }
  res.json({ success: true, count: notifs.length });
});

/**
 * GET /api/buyers
 * Returns all demo buyer profiles.
 */
app.get('/api/buyers', (req, res) => {
  res.json({ buyers });
});

/**
 * GET /api/config/maps
 * Returns the public Google Maps browser API key configuration.
 * Strictly exposes only the browser-safe Maps key — never leaks GEMINI_API_KEY
 * or other server secrets.
 */
app.get('/api/config/maps', (req, res) => {
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY;
  const isConfigured = Boolean(
    key &&
    key !== 'your_google_maps_browser_key_here' &&
    key.trim() !== ''
  );

  res.json({
    googleMapsBrowserKey: isConfigured ? key.trim() : '',
    configured: isConfigured
  });
});

/**
 * GET /api/config/razorpay
 * Returns public Razorpay configuration for test/live mode Checkout.
 * Never exposes RAZORPAY_KEY_SECRET or server credentials.
 */
app.get('/api/config/razorpay', (req, res) => {
  const status = defaultRazorpayService.getCredentialStatus();
  res.json(status);
});

/**
 * POST /api/analyze
 * Accepts an uploaded image, sends it to Gemini Vision for analysis.
 * Falls back to a safe default if Gemini is unavailable or returns invalid data.
 * The user always confirms or corrects the result before creating a listing.
 */
app.post('/api/analyze', (req, res) => {
  // Use multer as middleware inside the route to handle errors gracefully
  upload.single('waste-image')(req, res, async (err) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          error: 'Invalid file type. Please upload a JPG, PNG, or WebP image.'
        });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large. Maximum size is 5 MB.'
        });
      }
      return res.status(400).json({
        error: 'Image upload failed. Please try again.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided. Please upload a waste photo.'
      });
    }

    // Read the uploaded file into a buffer for Gemini, then clean up
    let imageBuffer;
    try {
      imageBuffer = fs.readFileSync(req.file.path);
    } catch (readErr) {
      removeUploadedFile(req.file.path);
      return res.status(500).json({
        error: 'Could not read the uploaded image. Please try again.'
      });
    }
    // Clean up the file immediately after reading
    removeUploadedFile(req.file.path);

    // Validate actual image content (magic bytes) to reject disguised non-image files
    if (!isValidImageBuffer(imageBuffer)) {
      return res.status(400).json({
        error: 'Uploaded file does not appear to be a valid JPG, PNG, or WebP image.'
      });
    }

    // Attempt Gemini Vision analysis
    let geminiResult = null;
    try {
      geminiResult = await analyzeImageWithGemini(imageBuffer, req.file.mimetype);
    } catch (aiErr) {
      console.error('Gemini analysis error:', aiErr.message);
    }

    if (geminiResult) {
      // Successful AI analysis
      return res.json({
        material: geminiResult.material,
        is_pet_bottle: geminiResult.is_pet_bottle,
        estimated_bottle_count: geminiResult.estimated_bottle_count,
        visible_condition: geminiResult.visible_condition,
        contamination_indicators: geminiResult.contamination_indicators,
        image_quality_limitations: geminiResult.image_quality_limitations,
        confidence: geminiResult.confidence,
        fallback_used: false,
        backend_status: 'AI_ANALYSIS_COMPLETED',
        note: geminiResult.notes || 'AI analysis complete. This is an estimate — please confirm or correct the material below.',
        warnings: geminiResult.warnings,
        is_rough_estimate: true,
        detailed_classification: geminiResult.detailed_classification || {
          wasteCategory: "Plastic",
          identifiedMaterial: geminiResult.material,
          materialSubtype: "Used PET beverage bottles",
          polymerType: "PET (Polyethylene Terephthalate, Resin #1)",
          confidence: geminiResult.confidence,
          recoveryPotential: "High",
          recyclable: true,
          reusable: false,
          condition: geminiResult.visible_condition,
          contamination: geminiResult.contamination_indicators.join(', ') || "No heavy visible contamination",
          moistureAndResidue: "Visual inspection suggests dry containers without significant slurry",
          sortingIssues: "Single polymer batch; minimal visible foreign plastic",
          processingState: "Loose post-consumer containers",
          damageOrDegradation: "Minor cosmetic crushing; polymer integrity suitable for flake conversion",
          recyclingMethod: "Mechanical shredding, hot washing, sink-float flake separation, and rPET pelletization",
          recommendedPreparationSteps: "Empty residual liquids, remove caps/rings if non-PET, flatten to optimize transport volume",
          recoveryReason: "Transparent rigid PET bottles have high global recycling demand and established domestic scrap buyback value",
          reuseMethods: ["Non-food storage containers", "Plant seedling pots", "Upcycled art/crafts"],
          environmentalImpact: "Recycling 1 ton of PET saves ~1.5 tons of CO2 equivalents compared to virgin resin production",
          recommendedAction: "Confirm batch weight and locality to match with certified regional recyclers",
          marketplaceEligible: true,
          warnings: geminiResult.warnings,
          verificationRequired: false,
          backendStatus: "AI Analysis Successful (Gemini 2.0 Flash)"
        }
      });
    }

    // Fallback: Gemini unavailable, no key, invalid response, or timeout
    const fallbackDetailed = {
      wasteCategory: "Plastic",
      identifiedMaterial: "PET Plastic (Estimated)",
      materialSubtype: "Post-consumer beverage bottles",
      polymerType: "Likely PET (#1)",
      confidence: "Unverified (Demo Mode)",
      recoveryPotential: "Needs verification",
      recyclable: true,
      reusable: false,
      condition: "Appears to be PET plastic beverage containers (Demo fallback)",
      contamination: "Labels present (unverified estimate)",
      moistureAndResidue: "Unknown — visual inspection requires physical verification",
      sortingIssues: "Unverified — check for non-PET caps or mixed polymers",
      processingState: "Loose containers",
      damageOrDegradation: "Unknown",
      recyclingMethod: "Mechanical recycling if verified as PET",
      recommendedPreparationSteps: "Ensure bottles are sorted, emptied, and free of food grease",
      recoveryReason: "Eligible for secondary mechanical recycling once material grade is human-confirmed",
      reuseMethods: ["Secondary utility storage"],
      environmentalImpact: "Proper diversion prevents plastic accumulation in landfills and waterways",
      recommendedAction: "Review material details and confirm your listing parameters",
      marketplaceEligible: true,
      warnings: ["Demo Fallback Active: AI Vision service is unconfigured or unreachable. Please verify all fields manually."],
      verificationRequired: true,
      backendStatus: "Fallback Active (Unverified — Manual Review Required)"
    };

    res.json({
      material: 'PET Plastic',
      is_pet_bottle: true,
      estimated_bottle_count: null,
      visible_condition: 'Appears to be PET plastic beverage containers',
      contamination_indicators: ['Labels present (demo estimate)'],
      image_quality_limitations: ['Not applicable (demo fallback used)'],
      confidence: 'Demo Fallback — AI analysis not available',
      fallback_used: true,
      backend_status: 'AI_FALLBACK_ACTIVE',
      detailed_classification: fallbackDetailed,
      note: 'AI analysis was not available (no API key, timeout, or service error). This is a default fallback estimate. Please confirm or correct the material below.',
      warnings: ['Demo fallback estimate: Please verify material, condition, and quantity before listing.'],
      is_rough_estimate: true
    });
  });
});

/**
 * POST /api/listings
 * Creates a new waste listing with validated data and optional GPS location.
 */
app.post('/api/listings', (req, res) => {
  const { confirmed_material, quantity_kg, locality, condition, location } = req.body;

  // --- Validate confirmed_material ---
  if (!confirmed_material || typeof confirmed_material !== 'string') {
    return res.status(400).json({ error: 'confirmed_material is required.' });
  }
  if (!ALLOWED_MATERIALS.includes(confirmed_material)) {
    return res.status(400).json({
      error: `Invalid material. Allowed values: ${ALLOWED_MATERIALS.join(', ')}.`
    });
  }

  // --- Validate quantity_kg ---
  const qty = Number(quantity_kg);
  if (quantity_kg === undefined || quantity_kg === null || quantity_kg === '') {
    return res.status(400).json({ error: 'quantity_kg is required.' });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantity_kg must be a positive finite number.' });
  }
  if (qty > MAX_QUANTITY_KG) {
    return res.status(400).json({
      error: `quantity_kg exceeds maximum allowed limit of ${MAX_QUANTITY_KG.toLocaleString()} kg.`
    });
  }

  // --- Validate locality ---
  if (!locality || typeof locality !== 'string') {
    return res.status(400).json({ error: 'locality is required.' });
  }
  if (!ALLOWED_LOCALITIES.includes(locality)) {
    return res.status(400).json({
      error: `Invalid locality. Allowed values: ${ALLOWED_LOCALITIES.join(', ')}.`
    });
  }

  // --- Validate condition ---
  if (!condition || typeof condition !== 'string') {
    return res.status(400).json({ error: 'condition is required.' });
  }
  if (!ALLOWED_CONDITIONS.includes(condition)) {
    return res.status(400).json({
      error: `Invalid condition. Allowed values: ${ALLOWED_CONDITIONS.join(', ')}.`
    });
  }

  // --- Validate optional location metadata (Google Maps) ---
  let validatedLocation = null;
  if (location !== undefined && location !== null) {
    if (typeof location !== 'object' || Array.isArray(location)) {
      return res.status(400).json({ error: 'location must be an object.' });
    }

    if (location.latitude !== undefined && location.latitude !== null) {
      const lat = Number(location.latitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return res.status(400).json({ error: 'location.latitude must be a finite number between -90 and 90.' });
      }
    }

    if (location.longitude !== undefined && location.longitude !== null) {
      const lng = Number(location.longitude);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'location.longitude must be a finite number between -180 and 180.' });
      }
    }

    if (location.formatted_address !== undefined && location.formatted_address !== null) {
      if (typeof location.formatted_address !== 'string') {
        return res.status(400).json({ error: 'location.formatted_address must be a string.' });
      }
    }

    if (location.place_id !== undefined && location.place_id !== null) {
      if (typeof location.place_id !== 'string') {
        return res.status(400).json({ error: 'location.place_id must be a string.' });
      }
    }

    validatedLocation = {
      formatted_address: typeof location.formatted_address === 'string' ? location.formatted_address.trim() : '',
      latitude: location.latitude !== undefined && location.latitude !== null ? Number(location.latitude) : null,
      longitude: location.longitude !== undefined && location.longitude !== null ? Number(location.longitude) : null,
      place_id: typeof location.place_id === 'string' ? location.place_id : null,
      locality: typeof location.locality === 'string' ? location.locality : locality
    };
  }

  // --- Determine listing ownership (Phase 10) ---
  const isAuthed = Boolean(req.user && req.user.id);
  if (!isAuthed && req.body && req.body.is_private === true) {
    return res.status(401).json({
      error: 'Anonymous users cannot create private listings. Please sign in.'
    });
  }

  const userId = isAuthed ? req.user.id : null;
  const isDemo = !isAuthed;

  // --- Create listing ---
  const listing = {
    id: generateListingId(),
    user_id: userId,
    is_demo: isDemo,
    confirmed_material,
    quantity_kg: qty,
    locality,
    condition,
    location: validatedLocation,
    status: 'LISTED',
    selected_buyer_id: null,
    recovery_status: 'LISTED',
    recovery_history: [
      {
        status: 'LISTED',
        timestamp: new Date().toISOString(),
        verified_by: isAuthed ? (req.user.name || 'Authenticated User') : 'System',
        note: 'Listing created for PET plastic bottle recovery.'
      }
    ],
    created_at: new Date().toISOString()
  };

  listings.push(listing);

  res.status(201).json({
    success: true,
    listing
  });
});

/**
 * GET /api/listings
 * Returns authorized listings: user-specific private listings when authenticated,
 * or public demo listings when unauthenticated.
 */
app.get('/api/listings', (req, res) => {
  if (req.user) {
    const userListings = listings.filter(l => l.user_id === req.user.id);
    return res.json({ listings: userListings });
  }
  // Unauthenticated callers receive public demo listings
  const demoListings = listings.filter(l => l.is_demo === true || l.user_id === null);
  res.json({ listings: demoListings });
});

/**
 * POST /api/reset
 * Clears all demo listings and resets state (disabled in production).
 */
app.post('/api/reset', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Reset endpoint is disabled in production.' });
  }
  listings = [];
  listingCounter = 0;
  transactions = [];
  transactionCounter = 0;
  defaultDb.resetBatches();
  defaultDb.resetNegotiations();
  defaultDb.resetReceipts();
  if (req.query && req.query.users === 'true') {
    defaultDb.resetUsers();
  }
  res.json({
    success: true,
    message: 'Demo state reset. All listings and transactions cleared.'
  });
});

/**
 * POST /api/match
 * Runs the deterministic buyer-matching engine against confirmed listing data.
 * Returns eligible buyers ranked by compatibility score, plus ineligible buyers
 * with exclusion reasons. Scores are heuristic ranking scores, not probabilities.
 */
app.post('/api/match', (req, res) => {
  let { listing_id, confirmed_material, quantity_kg, locality, condition } = req.body;

  // If a listing_id is provided, resolve directly from the in-memory listing
  // to ensure verified match parameters match the created listing exactly.
  if (listing_id) {
    const foundListing = listings.find(l => l.id === listing_id);
    if (!foundListing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    // Phase 10: Private listing authorization
    if (foundListing.user_id !== null) {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to access this private listing.' });
      }
      if (req.user.id !== foundListing.user_id) {
        return res.status(403).json({ error: 'You do not have permission to access this private listing.' });
      }
    }
    confirmed_material = foundListing.confirmed_material;
    quantity_kg = foundListing.quantity_kg;
    locality = foundListing.locality;
    condition = foundListing.condition;
  }

  // --- Validate confirmed_material ---
  if (!confirmed_material || typeof confirmed_material !== 'string') {
    return res.status(400).json({ error: 'confirmed_material is required.' });
  }
  if (!ALLOWED_MATERIALS.includes(confirmed_material)) {
    return res.status(400).json({
      error: `Invalid material. Allowed values: ${ALLOWED_MATERIALS.join(', ')}.`
    });
  }

  // --- Validate quantity_kg ---
  const qty = Number(quantity_kg);
  if (quantity_kg === undefined || quantity_kg === null || quantity_kg === '') {
    return res.status(400).json({ error: 'quantity_kg is required.' });
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantity_kg must be a positive finite number.' });
  }
  if (qty > MAX_QUANTITY_KG) {
    return res.status(400).json({
      error: `quantity_kg exceeds maximum allowed limit of ${MAX_QUANTITY_KG.toLocaleString()} kg.`
    });
  }

  // --- Validate locality ---
  if (!locality || typeof locality !== 'string') {
    return res.status(400).json({ error: 'locality is required.' });
  }
  if (!ALLOWED_LOCALITIES.includes(locality)) {
    return res.status(400).json({
      error: `Invalid locality. Allowed values: ${ALLOWED_LOCALITIES.join(', ')}.`
    });
  }

  // --- Validate condition ---
  if (!condition || typeof condition !== 'string') {
    return res.status(400).json({ error: 'condition is required.' });
  }
  if (!ALLOWED_CONDITIONS.includes(condition)) {
    return res.status(400).json({
      error: `Invalid condition. Allowed values: ${ALLOWED_CONDITIONS.join(', ')}.`
    });
  }

  // --- Run matching engine ---
  const listing = { confirmed_material, quantity_kg: qty, locality, condition };
  const result = matchBuyers(listing, buyers);

  res.json({
    success: true,
    listing_id: listing_id || null,
    geographic_distance_included: false,
    distance_note: 'Geographic distance ranking is not included because demo buyer profiles use zone-level coverage rather than verified GPS coordinates.',
    eligible: result.eligible,
    ineligible: result.ineligible,
    message: result.message
  });
});

/**
 * POST /api/prices/estimate
 * Calculates location-based PET scrap price intelligence and total value range.
 * Prefers { listing_id } to extract trusted in-memory listing parameters,
 * or accepts standalone { material, quantity_kg, locality, city, state, pincode, condition, grade, location, live }.
 */
app.post('/api/prices/estimate', (req, res) => {
  let { listing_id, material, quantity_kg, locality, city, state, pincode, condition, grade, location, live } = req.body || {};

  if (listing_id) {
    if (typeof listing_id !== 'string') {
      return res.status(400).json({ error: 'listing_id must be a string.' });
    }
    const foundListing = listings.find(l => l.id === listing_id);
    if (!foundListing) {
      return res.status(404).json({ error: 'Listing not found.' });
    }
    // Phase 10: Private listing authorization
    if (foundListing.user_id !== null) {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to access this private listing.' });
      }
      if (req.user.id !== foundListing.user_id) {
        return res.status(403).json({ error: 'You do not have permission to access this private listing.' });
      }
    }
    material = material || foundListing.confirmed_material;
    quantity_kg = quantity_kg !== undefined ? quantity_kg : foundListing.quantity_kg;
    locality = locality || foundListing.locality;
    condition = condition || foundListing.condition;
    location = location || foundListing.location;
  }

  const estimateInput = {
    listing_id: listing_id || null,
    material: material || 'PET Plastic',
    quantity_kg,
    locality,
    city,
    state,
    pincode,
    grade,
    condition: condition || 'Clean',
    location: location || null,
    live: live === true || live === 'true'
  };

  const result = estimatePetPrice(estimateInput, { db: defaultDb });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      status: result.status,
      error: result.error
    });
  }

  // Audit snapshot recording in SQLite
  try {
    if (defaultDb && typeof defaultDb.recordPriceSnapshot === 'function') {
      defaultDb.recordPriceSnapshot({
        listing_id: listing_id || null,
        user_id: req.user ? req.user.id : null,
        city: result.location ? result.location.city : (city || locality),
        state: result.location ? result.location.state : state,
        pincode: result.location ? result.location.pincode : pincode,
        material: result.material,
        grade: result.grade,
        condition: result.condition,
        quantity_kg: result.quantity_kg,
        estimated_min_per_kg: result.price_per_kg.min,
        estimated_max_per_kg: result.price_per_kg.max,
        reference_price_per_kg: result.price_per_kg.reference,
        estimated_batch_min: result.estimated_value.min,
        estimated_batch_max: result.estimated_value.max,
        source_name: result.source ? result.source.name : result.data_quality.source_name,
        source_type: result.source ? result.source.type : result.data_quality.source_type,
        geographic_level: result.geographic_coverage ? result.geographic_coverage.level : 'city',
        freshness_status: result.freshness || result.data_quality.freshness,
        observation_date: result.data_quality.observed_at,
        retrieval_timestamp: result.data_quality.retrieved_at,
        is_fallback: result.isFallback || result.is_fallback,
        disclaimer: result.explanation
      });
    }
  } catch (err) {
    console.warn('[PriceEstimate] Failed to record snapshot:', err.message);
  }

  res.json(result);
});

/**
 * GET /api/prices/records
 * Returns active benchmark price records for transparency and auditability.
 */
app.get('/api/prices/records', (_req, res) => {
  const records = defaultProvider.getRecords();
  res.json({
    success: true,
    count: records.length,
    records
  });
});

/**
 * GET /api/prices/grades
 * Returns standard material grade definitions with quality multipliers.
 */
app.get('/api/prices/grades', (_req, res) => {
  res.json({
    success: true,
    grades: Object.values(GRADE_SPECS).map(g => ({
      id: g.id,
      name: g.name,
      condition: g.condition,
      factor: g.factor,
      description: g.description,
      adjustment_reason: g.adjustment_reason
    }))
  });
});

/**
 * GET /api/prices/hubs
 * Returns known major Indian PET recycling hubs.
 */
app.get('/api/prices/hubs', (_req, res) => {
  const hubs = Object.entries(KNOWN_INDIAN_HUBS).map(([key, data]) => ({
    key,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    region: data.region
  }));
  res.json({
    success: true,
    hubs
  });
});

/**
 * POST /api/prices/refresh
 * Forces cache invalidation and recalculation for a location.
 */
app.post('/api/prices/refresh', (req, res) => {
  const { city, locality, pincode, grade, condition, quantity_kg = 50 } = req.body || {};
  if (defaultManager && typeof defaultManager.invalidateCache === 'function') {
    defaultManager.invalidateCache();
  }
  const result = estimatePetPrice({
    material: 'PET Plastic',
    quantity_kg: Number(quantity_kg) || 50,
    city: city || locality || 'Delhi',
    locality: locality || city || 'Delhi',
    pincode,
    grade,
    condition: condition || 'Clean',
    live: true
  }, { db: defaultDb });

  res.json({
    success: true,
    message: 'Cache invalidated and live price retrieved.',
    result
  });
});

/**
 * Order Creation Handler (supports /api/payments/create-order and /api/payment/create-order)
 */
async function handleCreateOrder(req, res) {
  const { listing_id, amount_paise = DEFAULT_FACILITATION_FEE_PAISE, currency = 'INR' } = req.body || {};

  if (!listing_id || typeof listing_id !== 'string') {
    return res.status(400).json({ error: 'listing_id is required.' });
  }

  const listing = listings.find(l => l.id === listing_id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found.' });
  }

  // Phase 10: Private listing authorization
  if (listing.user_id !== null) {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to access this private listing.' });
    }
    if (req.user.id !== listing.user_id) {
      return res.status(403).json({ error: 'You do not have permission to access this private listing.' });
    }
  }

  if (currency !== 'INR') {
    return res.status(400).json({ error: 'Only INR currency is supported.' });
  }

  const amt = Number(amount_paise);
  if (!Number.isInteger(amt) || amt < MIN_TRANSACTION_PAISE || amt > MAX_TRANSACTION_PAISE) {
    return res.status(400).json({
      error: `amount_paise must be an integer between ${MIN_TRANSACTION_PAISE} (₹1) and ${MAX_TRANSACTION_PAISE} (₹50,000).`
    });
  }

  // Prevent duplicate payment order creation if already verified
  const existingVerified = transactions.find(t => t.listing_id === listing_id && t.status === 'PAYMENT_VERIFIED');
  if (existingVerified) {
    return res.status(409).json({
      error: 'Listing payment has already been verified.',
      transaction: existingVerified
    });
  }

  if (!defaultRazorpayService.isConfigured() && !defaultRazorpayService.customClient) {
    return res.status(503).json({
      error: 'Razorpay test mode is not configured on this server. Please provide RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env to enable checkout.',
      configured: false
    });
  }

  try {
    const { order, transaction_ref, key_id } = await defaultRazorpayService.createOrder({
      listingId: listing.id,
      amountPaise: amt,
      currency,
      userId: req.user ? req.user.id : listing.user_id,
      buyerId: listing.buyer_id || null,
      notes: {
        material: listing.confirmed_material || 'PET Plastic',
        quantity_kg: String(listing.quantity_kg || 0)
      }
    });

    const transaction = {
      id: transaction_ref,
      listing_id: listing.id,
      order_id: order.id,
      payment_id: null,
      amount_paise: order.amount,
      currency: order.currency,
      status: 'ORDER_CREATED',
      created_at: new Date().toISOString(),
      verified_at: null,
      error: null
    };

    transactions.push(transaction);

    // Persist in SQLite
    try {
      defaultDb.createPaymentTransaction({
        transaction_ref,
        order_id: order.id,
        listing_id: listing.id,
        user_id: req.user ? req.user.id : listing.user_id,
        buyer_id: listing.buyer_id || null,
        amount_paise: order.amount,
        currency: order.currency,
        status: 'ORDER_CREATED',
        metadata_json: JSON.stringify({
          material: listing.confirmed_material,
          quantity_kg: listing.quantity_kg
        })
      });
    } catch (dbErr) {
      console.warn('SQLite payment transaction recording notice:', dbErr.message);
    }

    res.status(201).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      amount_paise: order.amount,
      currency: order.currency,
      key_id,
      listing_id: listing.id,
      transaction_id: transaction_ref,
      facilitation_fee_inr: (order.amount / 100).toFixed(2)
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('Razorpay order creation failed:', err.message || err);
    res.status(502).json({
      error: 'Failed to create Razorpay test order. Check credentials or network connectivity.'
    });
  }
}

app.post(['/api/payments/create-order', '/api/payment/create-order'], handleCreateOrder);

/**
 * Payment Verification Handler (supports /api/payments/verify and /api/payment/verify)
 */
function handleVerifyPayment(req, res) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount_paise, currency } = req.body || {};

  if (!razorpay_order_id || typeof razorpay_order_id !== 'string') {
    return res.status(400).json({ error: 'razorpay_order_id is required.' });
  }
  if (!razorpay_payment_id || typeof razorpay_payment_id !== 'string') {
    return res.status(400).json({ error: 'razorpay_payment_id is required.' });
  }
  if (!razorpay_signature || typeof razorpay_signature !== 'string') {
    return res.status(400).json({ error: 'razorpay_signature is required.' });
  }

  let tx = transactions.find(t => t.order_id === razorpay_order_id);
  const dbTx = defaultDb.findPaymentTransactionByOrderId(razorpay_order_id);
  if (!tx && dbTx) {
    tx = {
      id: dbTx.transaction_ref,
      listing_id: dbTx.listing_id,
      order_id: dbTx.order_id,
      payment_id: dbTx.payment_id,
      amount_paise: dbTx.amount_paise,
      currency: dbTx.currency,
      status: dbTx.status,
      created_at: dbTx.created_at,
      verified_at: dbTx.verified_at,
      error: dbTx.error_message
    };
    transactions.push(tx);
  }

  if (!tx) {
    return res.status(404).json({ error: 'Transaction order not found.' });
  }

  // Prevent payment ID reuse across different orders
  const reusedPayment = transactions.find(
    t => t.payment_id === razorpay_payment_id && t.order_id !== razorpay_order_id
  );
  const dbReused = defaultDb.findPaymentTransactionByPaymentId(razorpay_payment_id);
  if (reusedPayment || (dbReused && dbReused.order_id !== razorpay_order_id)) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: 'Payment ID has already been credited to another transaction.'
    });
  }

  // Validate amount and currency match the original order if passed in verification body
  if (amount_paise !== undefined && amount_paise !== null && Number(amount_paise) !== tx.amount_paise) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: `Transaction amount mismatch. Expected ${tx.amount_paise} paise, received ${amount_paise} paise.`
    });
  }
  if (currency !== undefined && currency !== null && currency !== tx.currency) {
    return res.status(400).json({
      success: false,
      verified: false,
      error: `Transaction currency mismatch. Expected ${tx.currency}, received ${currency}.`
    });
  }

  if (tx.status === 'PAYMENT_VERIFIED') {
    return res.json({
      success: true,
      verified: true,
      message: 'Payment has already been verified.',
      transaction: tx
    });
  }

  const isValid = defaultRazorpayService.verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature
  });

  if (!isValid) {
    tx.status = 'PAYMENT_FAILED';
    tx.error = 'Invalid payment signature.';
    try {
      defaultDb.updatePaymentTransactionStatus(tx.order_id, {
        status: 'PAYMENT_FAILED',
        errorMessage: 'Invalid payment signature.'
      });
    } catch (_) {}

    return res.status(400).json({
      success: false,
      verified: false,
      error: 'Payment signature verification failed. Untrusted or altered transaction response.'
    });
  }

  tx.status = 'PAYMENT_VERIFIED';
  tx.payment_id = razorpay_payment_id;
  tx.verified_at = new Date().toISOString();
  tx.error = null;

  try {
    defaultDb.updatePaymentTransactionStatus(tx.order_id, {
      status: 'PAYMENT_VERIFIED',
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      verifiedAt: tx.verified_at
    });
  } catch (_) {}

  // Update associated listing
  const listing = listings.find(l => l.id === tx.listing_id);
  if (listing) {
    listing.status = 'PAYMENT_VERIFIED';
    listing.recovery_history.push({
      status: listing.recovery_status,
      timestamp: tx.verified_at,
      verified_by: 'Razorpay Test Mode / Server Verification',
      note: `Demo facilitation fee verified in test mode (Payment ID: ${razorpay_payment_id}). Physical waste recovery status unchanged at ${listing.recovery_status}.`
    });
  }

  res.json({
    success: true,
    verified: true,
    payment_id: razorpay_payment_id,
    order_id: razorpay_order_id,
    verified_at: tx.verified_at,
    transaction: tx
  });
}

app.post(['/api/payments/verify', '/api/payment/verify'], handleVerifyPayment);

/**
 * Webhook Handler (supports /api/payments/webhook and /api/payment/webhook)
 */
app.post(['/api/payments/webhook', '/api/payment/webhook'], (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret && webhookSecret.trim()) {
    const isValid = defaultRazorpayService.verifyWebhookSignature({
      rawBody: req.rawBody,
      signature
    });
    if (!isValid) {
      return res.status(400).json({ success: false, error: 'Invalid webhook signature.' });
    }
  }

  const event = req.body || {};
  const eventType = event.event;

  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    const paymentEntity = event.payload && event.payload.payment && event.payload.payment.entity;
    const orderEntity = event.payload && event.payload.order && event.payload.order.entity;
    const orderId = (orderEntity && orderEntity.id) || (paymentEntity && paymentEntity.order_id);
    const paymentId = paymentEntity && paymentEntity.id;

    if (orderId) {
      const tx = transactions.find(t => t.order_id === orderId);
      if (tx) {
        tx.status = 'PAYMENT_VERIFIED';
        if (paymentId) tx.payment_id = paymentId;
        tx.verified_at = new Date().toISOString();
      }
      try {
        defaultDb.updatePaymentTransactionStatus(orderId, {
          status: 'PAYMENT_VERIFIED',
          paymentId: paymentId || undefined,
          verifiedAt: new Date().toISOString()
        });
      } catch (_) {}
    }
  } else if (eventType === 'payment.failed') {
    const paymentEntity = event.payload && event.payload.payment && event.payload.payment.entity;
    const orderId = paymentEntity && paymentEntity.order_id;
    if (orderId) {
      const tx = transactions.find(t => t.order_id === orderId);
      if (tx) {
        tx.status = 'PAYMENT_FAILED';
        tx.error = paymentEntity.error_description || 'Payment failed';
      }
      try {
        defaultDb.updatePaymentTransactionStatus(orderId, {
          status: 'PAYMENT_FAILED',
          errorMessage: paymentEntity.error_description || 'Payment failed'
        });
      } catch (_) {}
    }
  }

  res.json({ success: true, received: true, event: eventType });
});

/**
 * GET /api/payments/status/:listing_id
 * Retrieves payment transaction and physical recovery status for a listing.
 */
app.get('/api/payments/status/:listing_id', (req, res) => {
  const { listing_id } = req.params;
  const listing = listings.find(l => l.id === listing_id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found.' });
  }

  // Phase 10: Private listing authorization
  if (listing.user_id !== null) {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to access this private listing.' });
    }
    if (req.user.id !== listing.user_id) {
      return res.status(403).json({ error: 'You do not have permission to access this private listing.' });
    }
  }

  const tx = transactions.find(t => t.listing_id === listing_id);

  res.json({
    listing_id,
    payment_status: tx ? tx.status : 'NOT_CREATED',
    transaction: tx || null,
    recovery_status: listing.recovery_status || 'LISTED',
    recovery_history: listing.recovery_history || [],
    physical_recovery_verified: listing.recovery_status === 'RECOVERY_CONFIRMED',
    disclaimer: 'The demo facilitation fee is an administrative reservation deposit separate from actual physical collection, transport, and certified recycling verification.'
  });
});

/**
 * POST /api/listings/:id/recovery
 * Updates the physical recovery status of a waste listing.
 * Allowed statuses: LISTED, MATCHED, COLLECTION_CONFIRMED, RECOVERY_CONFIRMED
 * Enforces valid forward workflow progression:
 *   LISTED -> MATCHED -> COLLECTION_CONFIRMED -> RECOVERY_CONFIRMED
 * Explicitly kept distinct from financial payment state.
 */
app.post('/api/listings/:id/recovery', (req, res) => {
  const { id } = req.params;
  const { status, note, verified_by } = req.body || {};

  const listing = listings.find(l => l.id === id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found.' });
  }

  // Phase 10: Private listing authorization
  if (listing.user_id !== null) {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to access this private listing.' });
    }
    if (req.user.id !== listing.user_id) {
      return res.status(403).json({ error: 'You do not have permission to access this private listing.' });
    }
  }

  const ALLOWED_RECOVERY_STATUSES = [
    'LISTED',
    'MATCHED',
    'COLLECTION_CONFIRMED',
    'RECOVERY_CONFIRMED'
  ];

  if (!status || !ALLOWED_RECOVERY_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Invalid recovery status. Allowed values: ${ALLOWED_RECOVERY_STATUSES.join(', ')}.`
    });
  }

  // Enforce valid linear workflow progression
  const currentStatus = listing.recovery_status || 'LISTED';
  const VALID_NEXT_STATUSES = {
    LISTED: ['MATCHED'],
    MATCHED: ['COLLECTION_CONFIRMED'],
    COLLECTION_CONFIRMED: ['RECOVERY_CONFIRMED'],
    RECOVERY_CONFIRMED: []
  };

  if (status !== currentStatus && !VALID_NEXT_STATUSES[currentStatus]?.includes(status)) {
    return res.status(400).json({
      error: `Invalid status transition from ${currentStatus} to ${status}. Valid next status: ${VALID_NEXT_STATUSES[currentStatus]?.join(', ') || 'None (Terminal state)'}.`
    });
  }

  listing.recovery_status = status;
  const auditEntry = {
    status,
    timestamp: new Date().toISOString(),
    verified_by: typeof verified_by === 'string' && verified_by.trim() ? verified_by.trim() : 'Demo Operator (User-Entered)',
    note: typeof note === 'string' && note.trim() ? note.trim() : `Physical recovery status advanced to ${status}.`
  };
  listing.recovery_history.push(auditEntry);

  // Synchronize batch status and log hash-chained audit event if a batch exists
  const associatedBatch = defaultDb.findBatchByListingId(listing.id);
  if (associatedBatch) {
    defaultDb.updateBatchStatus(associatedBatch.id, status);
    recordAuditEvent(defaultDb, {
      batchId: associatedBatch.id,
      eventType: status === 'COLLECTION_CONFIRMED' ? 'COLLECTION_CONFIRMED' : (status === 'RECOVERY_CONFIRMED' ? 'RECOVERY_CONFIRMED' : 'STATUS_ADVANCED'),
      actorId: req.user ? req.user.name : (typeof verified_by === 'string' ? verified_by : 'System'),
      previousValue: currentStatus,
      newValue: status,
      explanation: auditEntry.note
    });
  }

  res.json({
    success: true,
    listing_id: listing.id,
    recovery_status: listing.recovery_status,
    recovery_history: listing.recovery_history
  });
});

// =============================================
// ECOPROOF LOOP ROUTES (Phase 11: Traceability & Audit)
// =============================================

function getPublicOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function findBatchByIdOrCode(idOrCode) {
  if (!idOrCode) return null;
  let batch = defaultDb.findBatchById(idOrCode);
  if (!batch) {
    batch = defaultDb.findBatchByCode(idOrCode);
  }
  return batch;
}

function checkBatchAuth(batch, req, res) {
  if (!batch) {
    res.status(404).json({ error: 'Recovery batch not found.' });
    return false;
  }
  if (batch.owner_id !== null && batch.owner_id !== undefined) {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required to access this recovery batch.' });
      return false;
    }
    if (req.user.id !== batch.owner_id && req.user.role !== 'admin') {
      res.status(403).json({ error: 'You do not have permission to access this recovery batch.' });
      return false;
    }
  }
  return true;
}

/**
 * POST /api/batches
 * Initializes an EcoProof recovery batch for a confirmed listing.
 */
app.post('/api/batches', (req, res) => {
  const { listing_id, collection_weight_kg, notes } = req.body || {};
  if (!listing_id || typeof listing_id !== 'string') {
    return res.status(400).json({ error: 'listing_id is required and must be a string.' });
  }

  const listing = listings.find(l => l.id === listing_id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found.' });
  }

  // Authorization check based on listing owner
  if (listing.user_id !== null) {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required to create a batch for this private listing.' });
    }
    if (req.user.id !== listing.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have permission to create a batch for this listing.' });
    }
  }

  // Idempotency: return existing batch if one already exists for this listing
  const existingBatch = defaultDb.findBatchByListingId(listing_id);
  if (existingBatch) {
    return res.status(200).json({
      success: true,
      message: 'Recovery batch already exists for this listing.',
      batch: existingBatch
    });
  }

  const batchCode = generateBatchCode();
  const ownerId = listing.user_id !== null ? listing.user_id : (req.user ? req.user.id : null);
  const actorName = req.user ? req.user.name : 'System';

  const batch = defaultDb.createBatch({
    batch_code: batchCode,
    listing_id: listing.id,
    owner_id: ownerId,
    buyer_id: listing.selected_buyer_id || null,
    material: listing.confirmed_material || 'PET Plastic',
    declared_quantity_kg: listing.quantity_kg || 0,
    collection_weight_kg: Number.isFinite(Number(collection_weight_kg)) && Number(collection_weight_kg) > 0 ? Number(collection_weight_kg) : null,
    receiving_weight_kg: null,
    status: listing.recovery_status || 'LISTED'
  });

  // Genesis audit event
  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'BATCH_INITIALIZED',
    actorId: actorName,
    previousValue: null,
    newValue: batch.status,
    explanation: notes || `EcoProof recovery batch initialized for PET listing ${listing.id}.`
  });

  res.status(201).json({
    success: true,
    message: 'EcoProof recovery batch created successfully.',
    batch
  });
});

/**
 * GET /api/batches/:id
 * Private batch details, evidence completeness score, weight discrepancy, and audit chain integrity.
 */
app.get('/api/batches/:id', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const evidenceList = defaultDb.listEvidenceByBatch(batch.id);
  const auditEvents = defaultDb.listAuditEventsByBatch(batch.id);
  const evidenceScore = calculateEvidenceScore(batch, evidenceList);
  const weightDiscrepancy = calculateWeightDiscrepancy(
    batch.collection_weight_kg,
    batch.receiving_weight_kg,
    batch.discrepancy_threshold_pct
  );
  const auditValidation = verifyAuditChain(auditEvents);

  res.json({
    success: true,
    batch,
    evidence: evidenceList,
    evidence_score: evidenceScore,
    weight_discrepancy: weightDiscrepancy,
    audit_chain_valid: auditValidation.valid,
    audit_events_count: auditEvents.length
  });
});

/**
 * GET /api/batches/:id/timeline
 * Audit event timeline for a batch.
 */
app.get('/api/batches/:id/timeline', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const events = defaultDb.listAuditEventsByBatch(batch.id);
  const validation = verifyAuditChain(events);

  res.json({
    success: true,
    events,
    audit_chain_valid: validation.valid
  });
});

/**
 * POST /api/batches/:id/evidence
 * Uploads an evidence file (JPEG, PNG, WebP up to 5MB) for a recovery milestone.
 */
app.post('/api/batches/:id/evidence', evidenceUpload.single('evidence_file'), async (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) {
    if (req.file) removeUploadedFile(req.file.path);
    return;
  }

  if (!req.file) {
    return res.status(400).json({ error: 'evidence_file is required (JPEG, PNG, WebP up to 5MB).' });
  }

  const category = req.body.category;
  if (!category || !EVIDENCE_CATEGORIES.includes(category)) {
    removeUploadedFile(req.file.path);
    return res.status(400).json({
      error: `Invalid evidence category. Must be one of: ${EVIDENCE_CATEGORIES.join(', ')}.`
    });
  }

  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(req.file.path);
  } catch (err) {
    removeUploadedFile(req.file.path);
    return res.status(500).json({ error: 'Failed to read uploaded evidence file.' });
  }

  if (!isValidImageBuffer(fileBuffer)) {
    removeUploadedFile(req.file.path);
    return res.status(400).json({
      error: 'Invalid file format. Only valid JPEG, PNG, or WebP images are permitted as evidence.'
    });
  }

  const fileSha256 = sha256(fileBuffer);
  const actorName = req.user ? req.user.name : 'Demo Operator';
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

  let aiReview = {
    ai_review_status: 'PENDING',
    ai_confidence: null,
    ai_notes: null
  };

  try {
    const aiResult = await analyzeEvidenceWithAi({
      filePath: req.file.path,
      category,
      declaredMaterial: batch.material,
      apiKey: process.env.GEMINI_API_KEY
    });
    if (aiResult) {
      aiReview.ai_review_status = aiResult.status || 'AI_REVIEWED';
      aiReview.ai_confidence = aiResult.confidence !== undefined ? aiResult.confidence : null;
      aiReview.ai_notes = aiResult.notes || null;
    }
  } catch (_aiErr) {
    aiReview.ai_review_status = 'PENDING';
  }

  const record = defaultDb.createEvidence({
    batch_id: batch.id,
    category,
    file_name: path.basename(req.file.path),
    original_name: req.file.originalname || 'evidence.jpg',
    file_size: req.file.size,
    mime_type: req.file.mimetype,
    sha256_hash: fileSha256,
    uploaded_by: actorName,
    notes,
    review_status: 'SUBMITTED',
    ai_review_status: aiReview.ai_review_status,
    ai_confidence: aiReview.ai_confidence,
    ai_notes: aiReview.ai_notes
  });

  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'EVIDENCE_SUBMITTED',
    actorId: actorName,
    previousValue: null,
    newValue: category,
    explanation: `Evidence uploaded for milestone ${category} (${record.original_name}, SHA-256: ${fileSha256.substring(0, 8)}...).`
  });

  res.status(201).json({
    success: true,
    evidence: record
  });
});

/**
 * GET /api/batches/:id/evidence
 * Lists all evidence records for a batch.
 */
app.get('/api/batches/:id/evidence', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const evidence = defaultDb.listEvidenceByBatch(batch.id);
  res.json({
    success: true,
    evidence
  });
});

/**
 * GET /api/batches/:id/evidence/:evidenceId/file
 * Serves the raw evidence file with strict authorization check.
 */
app.get('/api/batches/:id/evidence/:evidenceId/file', (req, res) => {
  const { id, evidenceId } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const record = defaultDb.findEvidenceById(evidenceId);
  if (!record || record.batch_id !== batch.id) {
    return res.status(404).json({ error: 'Evidence record not found.' });
  }

  const safeFilename = path.basename(record.file_name);
  const filePath = path.join(evidenceDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Evidence file not found on disk.' });
  }

  res.setHeader('Content-Type', record.mime_type || 'image/jpeg');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.original_name)}"`);
  res.sendFile(filePath);
});

/**
 * POST /api/batches/:id/collection-weight
 * Records collection weight in kg and evaluates discrepancy.
 */
app.post('/api/batches/:id/collection-weight', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const weight = Number(req.body.weight_kg);
  if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_QUANTITY_KG) {
    return res.status(400).json({
      error: `weight_kg must be a positive number greater than 0 and up to ${MAX_QUANTITY_KG} kg.`
    });
  }

  const prevWeight = batch.collection_weight_kg;
  defaultDb.updateBatchWeights(batch.id, weight, batch.receiving_weight_kg);
  const updatedBatch = defaultDb.findBatchById(batch.id);

  const actorName = req.user ? req.user.name : 'Operator';
  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'COLLECTION_WEIGHT_RECORDED',
    actorId: actorName,
    previousValue: prevWeight ? `${prevWeight} kg` : null,
    newValue: `${weight} kg`,
    explanation: req.body.notes || `Collection weight recorded as ${weight} kg.`
  });

  const discrepancy = calculateWeightDiscrepancy(
    updatedBatch.collection_weight_kg,
    updatedBatch.receiving_weight_kg,
    updatedBatch.discrepancy_threshold_pct
  );

  if (discrepancy.flagged) {
    recordAuditEvent(defaultDb, {
      batchId: batch.id,
      eventType: 'WEIGHT_DISCREPANCY_FLAGGED',
      actorId: 'System (EcoProof Guardian)',
      previousValue: null,
      newValue: `${discrepancy.discrepancyPercent}%`,
      explanation: discrepancy.message
    });
  }

  res.json({
    success: true,
    batch: updatedBatch,
    weight_discrepancy: discrepancy
  });
});

/**
 * POST /api/batches/:id/receiving-weight
 * Records receiving weight in kg and evaluates discrepancy.
 */
app.post('/api/batches/:id/receiving-weight', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const weight = Number(req.body.weight_kg);
  if (!Number.isFinite(weight) || weight <= 0 || weight > MAX_QUANTITY_KG) {
    return res.status(400).json({
      error: `weight_kg must be a positive number greater than 0 and up to ${MAX_QUANTITY_KG} kg.`
    });
  }

  const prevWeight = batch.receiving_weight_kg;
  defaultDb.updateBatchWeights(batch.id, batch.collection_weight_kg, weight);
  const updatedBatch = defaultDb.findBatchById(batch.id);

  const actorName = req.user ? req.user.name : 'Recycler Receiver';
  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'RECEIVING_WEIGHT_RECORDED',
    actorId: actorName,
    previousValue: prevWeight ? `${prevWeight} kg` : null,
    newValue: `${weight} kg`,
    explanation: req.body.notes || `Receiving weight recorded as ${weight} kg.`
  });

  const discrepancy = calculateWeightDiscrepancy(
    updatedBatch.collection_weight_kg,
    updatedBatch.receiving_weight_kg,
    updatedBatch.discrepancy_threshold_pct
  );

  if (discrepancy.flagged) {
    recordAuditEvent(defaultDb, {
      batchId: batch.id,
      eventType: 'WEIGHT_DISCREPANCY_FLAGGED',
      actorId: 'System (EcoProof Guardian)',
      previousValue: null,
      newValue: `${discrepancy.discrepancyPercent}%`,
      explanation: discrepancy.message
    });
  }

  res.json({
    success: true,
    batch: updatedBatch,
    weight_discrepancy: discrepancy
  });
});

/**
 * POST /api/batches/:id/evidence/:evidenceId/review
 * Updates the review status and reviewer notes on an evidence record.
 */
app.post('/api/batches/:id/evidence/:evidenceId/review', (req, res) => {
  const { id, evidenceId } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const record = defaultDb.findEvidenceById(evidenceId);
  if (!record || record.batch_id !== batch.id) {
    return res.status(404).json({ error: 'Evidence record not found.' });
  }

  const { status, notes } = req.body || {};
  const ALLOWED_STATUSES = ['REVIEWED', 'FLAGGED', 'SUBMITTED'];
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Invalid review status. Must be one of: ${ALLOWED_STATUSES.join(', ')}.`
    });
  }

  defaultDb.updateEvidenceReview(evidenceId, status, typeof notes === 'string' ? notes.trim() : '');
  const updated = defaultDb.findEvidenceById(evidenceId);

  const actorName = req.user ? req.user.name : 'Reviewer';
  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'EVIDENCE_REVIEWED',
    actorId: actorName,
    previousValue: record.review_status,
    newValue: status,
    explanation: notes || `Evidence for ${record.category} reviewed as ${status}.`
  });

  res.json({
    success: true,
    evidence: updated
  });
});

/**
 * POST /api/batches/:id/discrepancy/review
 * Records operator review notes for a weight discrepancy.
 */
app.post('/api/batches/:id/discrepancy/review', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const { review_notes, resolve_discrepancy } = req.body || {};
  const notes = typeof review_notes === 'string' ? review_notes.trim() : '';

  const actorName = req.user ? req.user.name : 'Reviewer';
  recordAuditEvent(defaultDb, {
    batchId: batch.id,
    eventType: 'DISCREPANCY_REVIEWED',
    actorId: actorName,
    previousValue: 'FLAGGED',
    newValue: resolve_discrepancy ? 'RESOLVED' : 'REVIEWED',
    explanation: notes || 'Weight discrepancy review recorded.'
  });

  res.json({
    success: true,
    message: 'Discrepancy review recorded.'
  });
});

/**
 * GET /api/batches/:id/score
 * Returns the calculated evidence completeness score.
 */
app.get('/api/batches/:id/score', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const evidenceList = defaultDb.listEvidenceByBatch(batch.id);
  const score = calculateEvidenceScore(batch, evidenceList);

  res.json({
    success: true,
    score
  });
});

/**
 * GET /api/batches/:id/audit
 * Returns full audit log and cryptographic verification.
 */
app.get('/api/batches/:id/audit', (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const events = defaultDb.listAuditEventsByBatch(batch.id);
  const validation = verifyAuditChain(events);

  res.json({
    success: true,
    events,
    audit_chain_valid: validation.valid,
    validation
  });
});

/**
 * GET /api/batches/:id/qr
 * Generates and returns a QR code data URL for public traceability.
 */
app.get('/api/batches/:id/qr', async (req, res) => {
  const { id } = req.params;
  const batch = findBatchByIdOrCode(id);
  if (!checkBatchAuth(batch, req, res)) return;

  const origin = getPublicOrigin(req);
  const traceUrl = `${origin}/trace/${batch.batch_code}`;
  try {
    const qrDataUrl = await generateBatchQrDataUrl(batch.batch_code, origin);
    res.json({
      success: true,
      batch_code: batch.batch_code,
      trace_url: traceUrl,
      qr_data_url: qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

/**
 * GET /api/trace/:batchCode
 * Public read-only endpoint returning sanitized batch details.
 * No coordinates, user emails, or internal hashes/keys.
 */
app.get('/api/trace/:batchCode', (req, res) => {
  const { batchCode } = req.params;
  const batch = defaultDb.findBatchByCode(batchCode);
  if (!batch) {
    return res.status(404).json({ error: 'Recovery batch not found.' });
  }

  const evidenceList = defaultDb.listEvidenceByBatch(batch.id);
  const auditEvents = defaultDb.listAuditEventsByBatch(batch.id);
  const sanitized = sanitizePublicBatchView(batch, evidenceList, auditEvents);

  res.json({
    success: true,
    ...sanitized
  });
});

// =============================================
// FEATURE 3: NEGOTIATION & COUNTEROFFER SYSTEM
// =============================================

/**
 * Synchronizes negotiation events into the in-platform chat and notification system.
 */
function syncNegotiationToConversation(negotiation, eventType, eventText, authorUser) {
  try {
    let conv = defaultDb.findConversationByListingAndBuyer(negotiation.listing_id, negotiation.buyer_id);
    if (!conv) {
      const convId = `conv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      conv = defaultDb.createConversation({
        id: convId,
        listing_id: negotiation.listing_id,
        seller_id: negotiation.seller_id,
        buyer_id: negotiation.buyer_id,
        negotiation_id: negotiation.id,
        subject: `Negotiation for Batch ${negotiation.listing_id}`
      });
    }
    const msgId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const recipientId = authorUser.id === negotiation.seller_id ? negotiation.buyer_id : negotiation.seller_id;
    defaultDb.createMessage({
      id: msgId,
      conversation_id: conv.id,
      sender_id: authorUser.id,
      recipient_id: recipientId,
      sender_role: authorUser.role || 'SELLER',
      body: eventText,
      message_type: 'OFFER_EVENT',
      metadata_json: JSON.stringify({ negotiation_id: negotiation.id, event_type: eventType })
    });
    defaultDb.createNotification({
      id: `notif_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      user_id: recipientId,
      type: eventType,
      title: `Negotiation Update: ${eventType}`,
      body: eventText.substring(0, 100),
      link: '#chat-panel'
    });
  } catch (err) {
    console.warn('Could not sync negotiation event to chat conversation:', err.message);
  }
}

/**
 * POST /api/negotiations
 * Initiates a new negotiation and submits an initial offer.
 */
app.post('/api/negotiations', requireAuth, csrfProtection, (req, res) => {
  const { listing_id, buyer_id, price_per_kg, initial_price_per_kg, quantity_kg, message, terms } = req.body;
  if (!listing_id || typeof listing_id !== 'string') {
    return res.status(400).json({ success: false, error: 'listing_id is required.' });
  }
  const listing = listings.find(l => l.id === listing_id);
  if (!listing) {
    return res.status(404).json({ success: false, error: 'Listing not found.' });
  }
  if (listing.owner_id && listing.owner_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'You do not own this listing.' });
  }
  if (!buyer_id || typeof buyer_id !== 'string') {
    return res.status(400).json({ success: false, error: 'buyer_id is required.' });
  }

  // Prevent conflicting active negotiations for same listing and buyer (return existing if active)
  const existingNeg = defaultDb.findNegotiationByListingAndBuyer(listing_id, buyer_id);
  if (existingNeg && (existingNeg.status === 'ACCEPTED' || existingNeg.status === 'PENDING' || existingNeg.status === 'COUNTERED')) {
    const rawOffer = defaultDb.getLatestOffer(existingNeg.id);
    const enrichedCurrent = rawOffer ? {
      ...rawOffer,
      proposed_price_per_kg: rawOffer.price_per_kg,
      proposer_role: rawOffer.offered_by_role,
      total_amount: rawOffer.total_value
    } : null;
    const offers = defaultDb.listOffersByNegotiation(existingNeg.id).map(o => ({
      ...o,
      proposed_price_per_kg: o.price_per_kg,
      proposer_role: o.offered_by_role,
      total_amount: o.total_value
    }));
    return res.status(200).json({
      success: true,
      negotiation: existingNeg,
      current_offer: enrichedCurrent,
      offer: enrichedCurrent,
      offers
    });
  }

  const rawPrice = price_per_kg !== undefined ? price_per_kg : initial_price_per_kg;
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ success: false, error: 'price_per_kg must be a positive number.' });
  }
  const qty = Number(quantity_kg || listing.quantity_kg);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QUANTITY_KG) {
    return res.status(400).json({ success: false, error: `quantity_kg must be between 1 and ${MAX_QUANTITY_KG} kg.` });
  }

  const neg = defaultDb.createNegotiation({
    listing_id,
    seller_id: req.user.id,
    buyer_id,
    status: 'PENDING'
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const offer = defaultDb.createOffer({
    negotiation_id: neg.id,
    revision_number: 1,
    offered_by_user_id: req.user.id,
    offered_by_role: 'SELLER',
    price_per_kg: price,
    quantity_kg: qty,
    message: message || 'Initial price offer based on material condition.',
    terms_json: terms || { transport_mode: 'RECYCLER_PICKUP' },
    status: 'PENDING',
    expires_at: expiresAt
  });

  defaultDb.updateNegotiationStatus(neg.id, 'PENDING', offer.id);

  const enrichedOffer = {
    ...offer,
    proposed_price_per_kg: offer.price_per_kg,
    proposer_role: offer.offered_by_role,
    total_amount: offer.total_value
  };

  syncNegotiationToConversation(
    neg,
    'NEW_OFFER',
    `Initial offer created: ₹${price.toFixed(2)}/kg for ${qty} kg (Total: ₹${(price * qty).toFixed(2)} INR).`,
    req.user
  );

  res.status(201).json({
    success: true,
    negotiation: defaultDb.findNegotiationById(neg.id),
    current_offer: enrichedOffer,
    offer: enrichedOffer
  });
});

/**
 * GET /api/negotiations
 * Lists negotiations for the authenticated user.
 */
app.get('/api/negotiations', requireAuth, (req, res) => {
  const negotiations = defaultDb.listNegotiationsByUser(req.user.id);
  const enhanced = negotiations.map(n => {
    const latestOffer = defaultDb.getLatestOffer(n.id);
    const listing = listings.find(l => l.id === n.listing_id);
    const buyer = buyers.find(b => b.id === n.buyer_id);
    return {
      ...n,
      latest_offer: latestOffer,
      listing: listing ? { id: listing.id, locality: listing.locality, condition: listing.condition, quantity_kg: listing.quantity_kg } : null,
      buyer_name: buyer ? buyer.name : n.buyer_id
    };
  });
  res.json({ success: true, negotiations: enhanced });
});

/**
 * GET /api/negotiations/:id
 * Retrieves a single negotiation with current offer and linked details.
 */
app.get('/api/negotiations/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const neg = defaultDb.findNegotiationById(id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied: You are not a participant in this negotiation.' });
  }
  const latestOffer = defaultDb.getLatestOffer(neg.id);
  const listing = listings.find(l => l.id === neg.listing_id);
  const buyer = buyers.find(b => b.id === neg.buyer_id);
  const receipt = defaultDb.findReceiptByNegotiationId(neg.id);

  res.json({
    success: true,
    negotiation: neg,
    latest_offer: latestOffer,
    listing,
    buyer,
    receipt
  });
});

/**
 * GET /api/negotiations/:id/offers
 * Returns the immutable revision history for a negotiation.
 */
app.get('/api/negotiations/:id/offers', requireAuth, (req, res) => {
  const { id } = req.params;
  const neg = defaultDb.findNegotiationById(id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  const offers = defaultDb.listOffersByNegotiation(neg.id);
  res.json({ success: true, offers });
});

/**
 * Helper to process counteroffers
 */
function handleCounterOffer(req, res, negotiationId, offerIdToCounter = null) {
  const neg = defaultDb.findNegotiationById(negotiationId);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  if (neg.status === 'ACCEPTED') {
    return res.status(400).json({ success: false, error: 'Cannot counter an already accepted negotiation.' });
  }
  if (neg.status === 'REJECTED' || neg.status === 'WITHDRAWN') {
    return res.status(400).json({ success: false, error: `Cannot counter a ${neg.status.toLowerCase()} negotiation.` });
  }

  const latestOffer = defaultDb.getLatestOffer(neg.id);
  if (!latestOffer) {
    return res.status(400).json({ success: false, error: 'No existing offer to counter.' });
  }
  if (latestOffer.expires_at && new Date(latestOffer.expires_at).getTime() < Date.now()) {
    defaultDb.updateOfferStatus(latestOffer.id, 'EXPIRED');
    defaultDb.updateNegotiationStatus(neg.id, 'EXPIRED');
    return res.status(400).json({ success: false, error: 'Offer has expired and cannot be countered.' });
  }

  const rawPrice = req.body.price_per_kg !== undefined ? req.body.price_per_kg : req.body.proposed_price_per_kg;
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ success: false, error: 'price_per_kg must be a positive number.' });
  }
  const qty = Number(req.body.quantity_kg || latestOffer.quantity_kg);
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QUANTITY_KG) {
    return res.status(400).json({ success: false, error: `quantity_kg must be between 1 and ${MAX_QUANTITY_KG} kg.` });
  }

  // Determine role
  let role = 'SELLER';
  if (req.user.id === neg.buyer_id || req.body.role === 'BUYER' || req.body.proposer_role === 'BUYER') {
    role = 'BUYER';
  }
  const offeredByUserId = (role === 'BUYER') ? neg.buyer_id : req.user.id;

  // Mark previous offer as SUPERSEDED
  defaultDb.updateOfferStatus(latestOffer.id, 'SUPERSEDED');

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const nextRev = (latestOffer.revision_number || 1) + 1;
  const newOffer = defaultDb.createOffer({
    negotiation_id: neg.id,
    revision_number: nextRev,
    offered_by_user_id: offeredByUserId,
    offered_by_role: role,
    price_per_kg: price,
    quantity_kg: qty,
    message: req.body.message || `Counteroffer (Revision ${nextRev}).`,
    terms_json: req.body.terms || latestOffer.terms || { transport_mode: 'RECYCLER_PICKUP' },
    status: 'PENDING',
    expires_at: expiresAt
  });

  defaultDb.updateNegotiationStatus(neg.id, 'COUNTERED', newOffer.id);

  const enrichedOffer = {
    ...newOffer,
    proposed_price_per_kg: newOffer.price_per_kg,
    proposer_role: newOffer.offered_by_role,
    total_amount: newOffer.total_value
  };

  syncNegotiationToConversation(
    neg,
    'COUNTEROFFER',
    `Counteroffer proposed (Rev ${nextRev}): ₹${price.toFixed(2)}/kg for ${qty} kg (Total: ₹${(price * qty).toFixed(2)} INR).`,
    req.user
  );

  res.status(201).json({
    success: true,
    negotiation: defaultDb.findNegotiationById(neg.id),
    current_offer: enrichedOffer,
    offer: enrichedOffer
  });
}

app.post('/api/negotiations/:id/offers', requireAuth, csrfProtection, (req, res) => {
  handleCounterOffer(req, res, req.params.id);
});

app.post('/api/offers/:id/counter', requireAuth, csrfProtection, (req, res) => {
  const offer = defaultDb.findOfferById(req.params.id);
  if (!offer) {
    return res.status(404).json({ success: false, error: 'Offer not found.' });
  }
  handleCounterOffer(req, res, offer.negotiation_id, offer.id);
});

/**
 * POST /api/offers/:id/accept
 * Accepts an offer and issues a digital waste transaction receipt.
 */
app.post('/api/offers/:id/accept', requireAuth, csrfProtection, (req, res) => {
  const { id } = req.params;
  const offer = defaultDb.findOfferById(id);
  if (!offer) {
    return res.status(404).json({ success: false, error: 'Offer not found.' });
  }
  const neg = defaultDb.findNegotiationById(offer.negotiation_id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }

  // Authorization: user must be participant
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied: You are not a participant in this negotiation.' });
  }

  // State machine validations
  if (neg.status === 'ACCEPTED') {
    return res.status(400).json({ success: false, error: 'Negotiation has already been accepted.' });
  }
  if (neg.status === 'REJECTED' || neg.status === 'WITHDRAWN') {
    return res.status(400).json({ success: false, error: `Cannot accept a ${neg.status.toLowerCase()} negotiation.` });
  }
  if (offer.status !== 'PENDING' && offer.status !== 'COUNTERED') {
    return res.status(400).json({ success: false, error: `Cannot accept an offer with status "${offer.status}".` });
  }

  // Expiration check
  if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
    defaultDb.updateOfferStatus(offer.id, 'EXPIRED');
    defaultDb.updateNegotiationStatus(neg.id, 'EXPIRED');
    return res.status(400).json({ success: false, error: 'Offer has expired and cannot be accepted.' });
  }

  // Prevent self-acceptance unless demo flag is passed
  if (offer.offered_by_user_id === req.user.id && !req.body.allow_self_accept_for_demo) {
    return res.status(400).json({
      success: false,
      error: 'You cannot accept your own offer. The opposing party must accept.'
    });
  }

  // Atomic update
  defaultDb.updateOfferStatus(offer.id, 'ACCEPTED');
  const updatedNeg = defaultDb.updateNegotiationStatus(neg.id, 'ACCEPTED', offer.id);

  // Check / Issue Digital Waste Transaction Receipt (Feature 5)
  let receipt = defaultDb.findReceiptByNegotiationId(neg.id);
  if (!receipt) {
    const listing = listings.find(l => l.id === neg.listing_id) || {
      id: neg.listing_id,
      confirmed_material: 'PET Plastic',
      condition: 'Clean',
      locality: 'Central City'
    };
    const sellerUser = defaultDb.findUserById(neg.seller_id);
    const buyerProfile = buyers.find(b => b.id === neg.buyer_id);

    let transportFeasibility = null;
    if (listing.location && listing.location.lat && listing.location.lng) {
      transportFeasibility = evaluateTransportFeasibility({
        seller_lat: listing.location.lat,
        seller_lng: listing.location.lng,
        buyer_id: neg.buyer_id,
        quantity_kg: offer.quantity_kg,
        price_per_kg: offer.price_per_kg,
        transport_mode: offer.terms && offer.terms.transport_mode ? offer.terms.transport_mode : 'RECYCLER_PICKUP'
      });
    }

    const receiptPayload = issueReceipt({
      negotiation: updatedNeg,
      offer,
      listing,
      sellerUser,
      buyerProfile,
      transportFeasibility
    });
    receipt = defaultDb.createReceipt(receiptPayload);
  }

  const acceptedOffer = defaultDb.findOfferById(offer.id);
  const enrichedOffer = acceptedOffer ? {
    ...acceptedOffer,
    proposed_price_per_kg: acceptedOffer.price_per_kg,
    proposer_role: acceptedOffer.offered_by_role,
    total_amount: acceptedOffer.total_value
  } : null;

  const enrichedReceipt = receipt ? {
    ...receipt,
    agreed_price_per_kg: receipt.unit_price,
    total_amount: receipt.gross_value
  } : null;

  syncNegotiationToConversation(
    neg,
    'OFFER_ACCEPTED',
    `🎉 Offer Accepted! Final terms: ₹${offer.price_per_kg.toFixed(2)}/kg for ${offer.quantity_kg} kg (Total: ₹${offer.total_value.toFixed(2)} INR). ${receipt ? 'Receipt ' + receipt.receipt_number + ' issued.' : ''}`,
    req.user
  );

  res.json({
    success: true,
    message: 'Offer accepted successfully. Agreed commercial transaction formed.',
    negotiation: updatedNeg,
    current_offer: enrichedOffer,
    offer: enrichedOffer,
    receipt: enrichedReceipt
  });
});

/**
 * POST /api/offers/:id/reject
 * Rejects an active offer.
 */
app.post('/api/offers/:id/reject', requireAuth, csrfProtection, (req, res) => {
  const { id } = req.params;
  const offer = defaultDb.findOfferById(id);
  if (!offer) {
    return res.status(404).json({ success: false, error: 'Offer not found.' });
  }
  const neg = defaultDb.findNegotiationById(offer.negotiation_id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  if (neg.status === 'ACCEPTED') {
    return res.status(400).json({ success: false, error: 'Cannot reject an already accepted negotiation.' });
  }

  defaultDb.updateOfferStatus(offer.id, 'REJECTED');
  const updatedNeg = defaultDb.updateNegotiationStatus(neg.id, 'REJECTED', offer.id);

  syncNegotiationToConversation(
    neg,
    'OFFER_REJECTED',
    `Offer of ₹${offer.price_per_kg.toFixed(2)}/kg was rejected.`,
    req.user
  );

  res.json({
    success: true,
    message: 'Offer rejected.',
    negotiation: updatedNeg,
    offer: defaultDb.findOfferById(offer.id)
  });
});

/**
 * POST /api/offers/:id/withdraw
 * Withdraws an outstanding offer by the offering party.
 */
app.post('/api/offers/:id/withdraw', requireAuth, csrfProtection, (req, res) => {
  const { id } = req.params;
  const offer = defaultDb.findOfferById(id);
  if (!offer) {
    return res.status(404).json({ success: false, error: 'Offer not found.' });
  }
  const neg = defaultDb.findNegotiationById(offer.negotiation_id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }

  if (offer.offered_by_user_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Only the user who proposed this offer can withdraw it.' });
  }
  if (offer.status === 'ACCEPTED') {
    return res.status(400).json({ success: false, error: 'Cannot withdraw an already accepted offer.' });
  }

  defaultDb.updateOfferStatus(offer.id, 'WITHDRAWN');
  const updatedNeg = defaultDb.updateNegotiationStatus(neg.id, 'WITHDRAWN', offer.id);

  syncNegotiationToConversation(
    neg,
    'OFFER_WITHDRAWN',
    `Offer of ₹${offer.price_per_kg.toFixed(2)}/kg was withdrawn.`,
    req.user
  );

  res.json({
    success: true,
    message: 'Offer withdrawn successfully.',
    negotiation: updatedNeg,
    offer: defaultDb.findOfferById(offer.id)
  });
});

// =============================================
// FEATURE 4: TRANSPORT FEASIBILITY CHECKER
// =============================================

/**
 * POST /api/transport/feasibility
 * Evaluates transport distance, cost model, and economic feasibility.
 */
app.post('/api/transport/feasibility', (req, res) => {
  let { seller_lat, seller_lng, pickup_lat, pickup_lng, buyer_id, quantity_kg, price_per_kg, unit_price, transport_mode, listing_id } = req.body;

  if (listing_id && (seller_lat === undefined && pickup_lat === undefined)) {
    const listing = listings.find(l => l.id === listing_id);
    if (listing && listing.location) {
      seller_lat = listing.location.latitude !== undefined ? listing.location.latitude : listing.location.lat;
      seller_lng = listing.location.longitude !== undefined ? listing.location.longitude : listing.location.lng;
    }
    if (listing && !quantity_kg) {
      quantity_kg = listing.quantity_kg;
    }
  }

  const sLat = typeof pickup_lat === 'number' ? pickup_lat : seller_lat;
  const sLng = typeof pickup_lng === 'number' ? pickup_lng : seller_lng;
  const price = unit_price !== undefined ? unit_price : price_per_kg;

  if (buyer_id && !getBuyerFacility(buyer_id)) {
    return res.status(404).json({
      success: false,
      error: `Buyer facility "${buyer_id}" not found.`
    });
  }

  const report = evaluateTransportFeasibility({
    seller_lat: sLat,
    seller_lng: sLng,
    buyer_id,
    quantity_kg,
    price_per_kg: price,
    transport_mode
  });

  res.json({
    success: true,
    ...report
  });
});

// =============================================
// FEATURE 5: DIGITAL WASTE TRANSACTION RECEIPTS
// =============================================

/**
 * GET /api/negotiations/:id/receipt
 * Retrieves receipt associated with an accepted negotiation.
 */
app.get('/api/negotiations/:id/receipt', requireAuth, (req, res) => {
  const neg = defaultDb.findNegotiationById(req.params.id);
  if (!neg) {
    return res.status(404).json({ success: false, error: 'Negotiation not found.' });
  }
  if (neg.seller_id !== req.user.id && neg.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  const receipt = defaultDb.findReceiptByNegotiationId(neg.id);
  if (!receipt) {
    return res.status(404).json({ success: false, error: 'No receipt found for this negotiation. An offer must be accepted first.' });
  }
  const integrity = verifyReceiptIntegrity(receipt);
  res.json({
    success: true,
    receipt: {
      ...receipt,
      integrity_status: integrity.status
    }
  });
});

/**
 * GET /api/receipts/:receiptNumber
 * Retrieves receipt details for an authorized seller or buyer.
 */
app.get('/api/receipts/:receiptNumber', requireAuth, (req, res) => {
  const receipt = defaultDb.findReceiptByNumber(req.params.receiptNumber);
  if (!receipt) {
    return res.status(404).json({ success: false, error: 'Receipt not found.' });
  }
  if (receipt.seller_id !== req.user.id && receipt.buyer_id !== req.user.id) {
    return res.status(403).json({ success: false, error: 'Access denied to private receipt details.' });
  }
  const integrity = verifyReceiptIntegrity(receipt);
  res.json({
    success: true,
    receipt: {
      ...receipt,
      integrity_status: integrity.status
    }
  });
});

/**
 * GET /api/receipts/:receiptNumber/verify
 * Public verification endpoint for digital receipts.
 * Returns sanitized proof of transaction with SHA-256 digest validation.
 */
app.get('/api/receipts/:receiptNumber/verify', (req, res) => {
  const receipt = defaultDb.findReceiptByNumber(req.params.receiptNumber);
  if (!receipt) {
    return res.status(404).json({
      success: false,
      error: 'Receipt not found.',
      disclaimer: RECEIPT_DISCLAIMER
    });
  }
  const sanitized = getSanitizedPublicReceipt(receipt);
  const integrity = verifyReceiptIntegrity(receipt);
  res.json({
    success: true,
    valid: integrity.valid,
    receipt: sanitized,
    verification: sanitized,
    disclaimer: RECEIPT_DISCLAIMER
  });
});

/**
 * GET /trace/:batchCode
 * Serves the public HTML traceability view.
 */
app.get('/trace/:batchCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trace.html'));
});

// --- Global error handler for unexpected errors ---
app.use((err, req, res, _next) => {
  console.error('Unhandled server error:', err.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`\n  EcoCycle AI server running at http://localhost:${PORT}\n`);
});
