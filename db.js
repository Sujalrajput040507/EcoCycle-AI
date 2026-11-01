/**
 * EcoCycle AI — SQLite Database Module
 *
 * Implements persistent user storage and session management using Node.js built-in
 * `node:sqlite` (DatabaseSync), requiring zero external native compilation.
 *
 * Security:
 * - All queries are strictly parameterized (prevents SQL injection).
 * - Password hashes are stored safely in SQLite; plaintext passwords never persist.
 * - Normalized emails carry a UNIQUE constraint at the schema level.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class AuthDatabase {
  /**
   * @param {string} [dbPath] - Path to SQLite database file or ':memory:'
   */
  constructor(dbPath) {
    const defaultPath = path.join(__dirname, 'data', 'ecocycle-auth.db');
    this.dbPath = dbPath || process.env.ECOCYCLE_DB_PATH || defaultPath;

    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this._initSchema();
    this._prepareStatements();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_normalized);

      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

      CREATE TABLE IF NOT EXISTS recovery_batches (
        id TEXT PRIMARY KEY,
        batch_code TEXT NOT NULL UNIQUE,
        listing_id TEXT NOT NULL,
        owner_id TEXT,
        buyer_id TEXT,
        material_type TEXT NOT NULL DEFAULT 'PET Plastic',
        declared_quantity_kg REAL NOT NULL,
        collection_weight_kg REAL,
        receiving_weight_kg REAL,
        weight_discrepancy_flagged INTEGER NOT NULL DEFAULT 0,
        weight_discrepancy_note TEXT,
        status TEXT NOT NULL DEFAULT 'LISTED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batches_listing ON recovery_batches(listing_id);
      CREATE INDEX IF NOT EXISTS idx_batches_code ON recovery_batches(batch_code);
      CREATE INDEX IF NOT EXISTS idx_batches_owner ON recovery_batches(owner_id);

      CREATE TABLE IF NOT EXISTS evidence_records (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        category TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        storage_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        sha256_hash TEXT NOT NULL,
        uploader_id TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        review_notes TEXT,
        reviewer_id TEXT,
        reviewed_at TEXT,
        ai_review_label TEXT,
        ai_review_explanation TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_batch ON evidence_records(batch_id);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        previous_value TEXT,
        new_value TEXT,
        explanation TEXT,
        evidence_id TEXT,
        previous_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_events(batch_id);

      -- Negotiations & Counteroffers
      CREATE TABLE IF NOT EXISTS negotiations (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        current_offer_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_negotiations_listing ON negotiations(listing_id);
      CREATE INDEX IF NOT EXISTS idx_negotiations_seller ON negotiations(seller_id);
      CREATE INDEX IF NOT EXISTS idx_negotiations_buyer ON negotiations(buyer_id);

      CREATE TABLE IF NOT EXISTS negotiation_offers (
        id TEXT PRIMARY KEY,
        negotiation_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL,
        offered_by_user_id TEXT NOT NULL,
        offered_by_role TEXT NOT NULL DEFAULT 'SELLER',
        price_per_kg REAL NOT NULL,
        quantity_kg REAL NOT NULL,
        total_value REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        message TEXT,
        terms_json TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        expires_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_offers_negotiation ON negotiation_offers(negotiation_id);

      -- Digital Waste Transaction Receipts
      CREATE TABLE IF NOT EXISTS waste_receipts (
        id TEXT PRIMARY KEY,
        receipt_number TEXT NOT NULL UNIQUE,
        transaction_id TEXT NOT NULL UNIQUE,
        negotiation_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        material TEXT NOT NULL,
        quantity_kg REAL NOT NULL,
        unit_price REAL NOT NULL,
        gross_value REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        transport_terms_json TEXT,
        payment_status TEXT NOT NULL DEFAULT 'PENDING',
        payment_id TEXT,
        batch_id TEXT,
        status TEXT NOT NULL DEFAULT 'AGREEMENT_CONFIRMED',
        canonical_digest TEXT NOT NULL,
        receipt_data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_number ON waste_receipts(receipt_number);
      CREATE INDEX IF NOT EXISTS idx_receipts_txn ON waste_receipts(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_negotiation ON waste_receipts(negotiation_id);

      -- In-Platform Conversations
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        listing_id TEXT,
        seller_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        negotiation_id TEXT,
        subject TEXT,
        last_message_at TEXT,
        last_message_snippet TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conv_seller ON conversations(seller_id);
      CREATE INDEX IF NOT EXISTS idx_conv_buyer ON conversations(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_conv_listing ON conversations(listing_id);

      -- In-Platform Messages
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        sender_role TEXT NOT NULL DEFAULT 'SELLER',
        body TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'TEXT',
        metadata_json TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient_id);

      -- In-App Notifications
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

      -- Payment Transactions (Razorpay Facilitation Deposits & Settlement)
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id TEXT PRIMARY KEY,
        transaction_ref TEXT NOT NULL UNIQUE,
        order_id TEXT NOT NULL UNIQUE,
        payment_id TEXT UNIQUE,
        listing_id TEXT,
        user_id TEXT,
        buyer_id TEXT,
        amount_paise INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        status TEXT NOT NULL DEFAULT 'ORDER_CREATED',
        method TEXT,
        signature TEXT,
        error_message TEXT,
        idempotency_key TEXT,
        created_at TEXT NOT NULL,
        verified_at TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pay_order ON payment_transactions(order_id);
      CREATE INDEX IF NOT EXISTS idx_pay_listing ON payment_transactions(listing_id);
      CREATE INDEX IF NOT EXISTS idx_pay_user ON payment_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_pay_payment_id ON payment_transactions(payment_id);

      -- Market Price Observations (Live, Recycler Quotations, Transactions, Benchmarks)
      CREATE TABLE IF NOT EXISTS price_observations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_url TEXT,
        source_type TEXT NOT NULL,
        material TEXT NOT NULL DEFAULT 'PET Plastic',
        material_form TEXT NOT NULL DEFAULT 'used_beverage_bottles',
        grade TEXT NOT NULL,
        condition TEXT NOT NULL DEFAULT 'Clean',
        geographic_scope TEXT NOT NULL,
        city TEXT,
        state TEXT,
        pincode TEXT,
        country TEXT NOT NULL DEFAULT 'India',
        price_min_per_kg REAL NOT NULL,
        price_max_per_kg REAL NOT NULL,
        observed_price REAL,
        currency TEXT NOT NULL DEFAULT 'INR',
        unit TEXT NOT NULL DEFAULT 'kg',
        observed_at TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        expires_at TEXT,
        data_mode TEXT NOT NULL DEFAULT 'LIVE',
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_obs_city_mat ON price_observations(city, material, material_form);
      CREATE INDEX IF NOT EXISTS idx_obs_state_mat ON price_observations(state, material, material_form);
      CREATE INDEX IF NOT EXISTS idx_obs_type ON price_observations(source_type);

      -- Price Estimate Snapshots (Audit trail for estimates associated with listings & transactions)
      CREATE TABLE IF NOT EXISTS price_estimate_snapshots (
        id TEXT PRIMARY KEY,
        listing_id TEXT,
        user_id TEXT,
        city TEXT,
        state TEXT,
        pincode TEXT,
        material TEXT NOT NULL,
        grade TEXT NOT NULL,
        condition TEXT NOT NULL,
        quantity_kg REAL NOT NULL,
        estimated_min_per_kg REAL NOT NULL,
        estimated_max_per_kg REAL NOT NULL,
        reference_price_per_kg REAL NOT NULL,
        estimated_batch_min REAL NOT NULL,
        estimated_batch_max REAL NOT NULL,
        source_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        geographic_level TEXT NOT NULL,
        freshness_status TEXT NOT NULL,
        observation_date TEXT NOT NULL,
        retrieval_timestamp TEXT NOT NULL,
        is_fallback INTEGER NOT NULL DEFAULT 0,
        disclaimer TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snap_listing ON price_estimate_snapshots(listing_id);
    `);

    // Additive migration columns for users table
    const userCols = this.db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('role')) this.db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'SELLER'");
    if (!userCols.includes('phone')) this.db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    if (!userCols.includes('user_type')) this.db.exec("ALTER TABLE users ADD COLUMN user_type TEXT");
    if (!userCols.includes('city')) this.db.exec("ALTER TABLE users ADD COLUMN city TEXT");
    if (!userCols.includes('state')) this.db.exec("ALTER TABLE users ADD COLUMN state TEXT");
    if (!userCols.includes('address')) this.db.exec("ALTER TABLE users ADD COLUMN address TEXT");
    if (!userCols.includes('category')) this.db.exec("ALTER TABLE users ADD COLUMN category TEXT");
    if (!userCols.includes('preferred_materials')) this.db.exec("ALTER TABLE users ADD COLUMN preferred_materials TEXT");
    if (!userCols.includes('purchasing_capacity')) this.db.exec("ALTER TABLE users ADD COLUMN purchasing_capacity REAL");
    if (!userCols.includes('collection_radius')) this.db.exec("ALTER TABLE users ADD COLUMN collection_radius REAL");
    if (!userCols.includes('preferences_json')) this.db.exec("ALTER TABLE users ADD COLUMN preferences_json TEXT");
    if (!userCols.includes('reset_token')) this.db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT");
    if (!userCols.includes('reset_token_expire')) this.db.exec("ALTER TABLE users ADD COLUMN reset_token_expire INTEGER");
  }

  _prepareStatements() {
    this.stmtInsertUser = this.db.prepare(`
      INSERT INTO users (
        id, name, email_normalized, password_hash, created_at, updated_at,
        role, phone, user_type, city, state, address, category,
        preferred_materials, purchasing_capacity, collection_radius, preferences_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindUserByEmail = this.db.prepare(`
      SELECT *
      FROM users
      WHERE email_normalized = ?
    `);

    this.stmtFindUserById = this.db.prepare(`
      SELECT id, name, email_normalized, created_at, updated_at,
             role, phone, user_type, city, state, address, category,
             preferred_materials, purchasing_capacity, collection_radius, preferences_json
      FROM users
      WHERE id = ?
    `);

    this.stmtFindUserByIdWithHash = this.db.prepare(`
      SELECT *
      FROM users
      WHERE id = ?
    `);

    this.stmtUpdateUserProfile = this.db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          user_type = COALESCE(?, user_type),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          address = COALESCE(?, address),
          category = COALESCE(?, category),
          preferred_materials = COALESCE(?, preferred_materials),
          purchasing_capacity = COALESCE(?, purchasing_capacity),
          collection_radius = COALESCE(?, collection_radius),
          preferences_json = COALESCE(?, preferences_json),
          updated_at = ?
      WHERE id = ?
    `);

    this.stmtSetResetToken = this.db.prepare(`
      UPDATE users
      SET reset_token = ?, reset_token_expire = ?, updated_at = ?
      WHERE email_normalized = ?
    `);

    this.stmtFindUserByResetToken = this.db.prepare(`
      SELECT *
      FROM users
      WHERE reset_token = ? AND reset_token_expire > ?
    `);

    this.stmtUpdatePasswordWithReset = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, reset_token = NULL, reset_token_expire = NULL, updated_at = ?
      WHERE id = ?
    `);

    this.stmtDeleteUser = this.db.prepare(`
      DELETE FROM users WHERE id = ?
    `);

    this.stmtCountUsers = this.db.prepare(`
      SELECT COUNT(*) as count FROM users
    `);

    this.stmtGetSession = this.db.prepare(`
      SELECT sess, expire FROM sessions WHERE sid = ?
    `);

    this.stmtSetSession = this.db.prepare(`
      INSERT INTO sessions (sid, sess, expire)
      VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
    `);

    this.stmtDestroySession = this.db.prepare(`
      DELETE FROM sessions WHERE sid = ?
    `);

    this.stmtCleanExpiredSessions = this.db.prepare(`
      DELETE FROM sessions WHERE expire < ?
    `);

    this.stmtResetAll = this.db.prepare(`
      DELETE FROM users
    `);

    // --- Recovery Batches Statements ---
    this.stmtInsertBatch = this.db.prepare(`
      INSERT INTO recovery_batches (
        id, batch_code, listing_id, owner_id, buyer_id, material_type,
        declared_quantity_kg, collection_weight_kg, receiving_weight_kg,
        weight_discrepancy_flagged, weight_discrepancy_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindBatchById = this.db.prepare(`
      SELECT * FROM recovery_batches WHERE id = ?
    `);

    this.stmtFindBatchByCode = this.db.prepare(`
      SELECT * FROM recovery_batches WHERE batch_code = ?
    `);

    this.stmtFindBatchByListingId = this.db.prepare(`
      SELECT * FROM recovery_batches WHERE listing_id = ?
    `);

    this.stmtListBatchesByOwner = this.db.prepare(`
      SELECT * FROM recovery_batches WHERE owner_id = ? ORDER BY created_at DESC
    `);

    this.stmtUpdateBatchWeights = this.db.prepare(`
      UPDATE recovery_batches
      SET collection_weight_kg = ?, receiving_weight_kg = ?,
          weight_discrepancy_flagged = ?, weight_discrepancy_note = ?, updated_at = ?
      WHERE id = ?
    `);

    this.stmtUpdateBatchStatus = this.db.prepare(`
      UPDATE recovery_batches
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);

    this.stmtUpdateBatchBuyer = this.db.prepare(`
      UPDATE recovery_batches
      SET buyer_id = ?, updated_at = ?
      WHERE id = ?
    `);

    // --- Evidence Records Statements ---
    this.stmtInsertEvidence = this.db.prepare(`
      INSERT INTO evidence_records (
        id, batch_id, category, original_filename, storage_filename, mime_type,
        file_size, sha256_hash, uploader_id, notes, status, review_notes,
        reviewer_id, reviewed_at, ai_review_label, ai_review_explanation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtListEvidenceByBatch = this.db.prepare(`
      SELECT * FROM evidence_records WHERE batch_id = ? ORDER BY created_at ASC
    `);

    this.stmtFindEvidenceById = this.db.prepare(`
      SELECT * FROM evidence_records WHERE id = ?
    `);

    this.stmtUpdateEvidenceReview = this.db.prepare(`
      UPDATE evidence_records
      SET status = ?, review_notes = ?, reviewer_id = ?, reviewed_at = ?
      WHERE id = ?
    `);

    this.stmtUpdateEvidenceAiReview = this.db.prepare(`
      UPDATE evidence_records
      SET ai_review_label = ?, ai_review_explanation = ?
      WHERE id = ?
    `);

    // --- Audit Events Statements (Hash Chain) ---
    this.stmtInsertAuditEvent = this.db.prepare(`
      INSERT INTO audit_events (
        id, batch_id, sequence, event_type, actor_id, previous_value,
        new_value, explanation, evidence_id, previous_hash, event_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtListAuditEventsByBatch = this.db.prepare(`
      SELECT * FROM audit_events WHERE batch_id = ? ORDER BY sequence ASC
    `);

    this.stmtGetLastAuditEvent = this.db.prepare(`
      SELECT * FROM audit_events WHERE batch_id = ? ORDER BY sequence DESC LIMIT 1
    `);

    this.stmtResetBatches = this.db.prepare(`
      DELETE FROM recovery_batches
    `);
    this.stmtResetEvidence = this.db.prepare(`
      DELETE FROM evidence_records
    `);
    this.stmtResetAudit = this.db.prepare(`
      DELETE FROM audit_events
    `);

    // --- Negotiations Statements ---
    this.stmtInsertNegotiation = this.db.prepare(`
      INSERT INTO negotiations (id, listing_id, seller_id, buyer_id, status, current_offer_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindNegotiationById = this.db.prepare(`
      SELECT * FROM negotiations WHERE id = ?
    `);

    this.stmtFindNegotiationByListingAndBuyer = this.db.prepare(`
      SELECT * FROM negotiations WHERE listing_id = ? AND buyer_id = ?
    `);

    this.stmtListNegotiationsByUser = this.db.prepare(`
      SELECT * FROM negotiations WHERE seller_id = ? OR buyer_id = ? ORDER BY updated_at DESC
    `);

    this.stmtUpdateNegotiationStatus = this.db.prepare(`
      UPDATE negotiations SET status = ?, current_offer_id = ?, updated_at = ? WHERE id = ?
    `);

    // --- Negotiation Offers Statements ---
    this.stmtInsertOffer = this.db.prepare(`
      INSERT INTO negotiation_offers (
        id, negotiation_id, revision_number, offered_by_user_id, offered_by_role,
        price_per_kg, quantity_kg, total_value, currency, message, terms_json, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindOfferById = this.db.prepare(`
      SELECT * FROM negotiation_offers WHERE id = ?
    `);

    this.stmtListOffersByNegotiation = this.db.prepare(`
      SELECT * FROM negotiation_offers WHERE negotiation_id = ? ORDER BY revision_number ASC
    `);

    this.stmtGetLatestOffer = this.db.prepare(`
      SELECT * FROM negotiation_offers WHERE negotiation_id = ? ORDER BY revision_number DESC LIMIT 1
    `);

    this.stmtUpdateOfferStatus = this.db.prepare(`
      UPDATE negotiation_offers SET status = ? WHERE id = ?
    `);

    // --- Waste Receipts Statements ---
    this.stmtInsertReceipt = this.db.prepare(`
      INSERT INTO waste_receipts (
        id, receipt_number, transaction_id, negotiation_id, offer_id, listing_id,
        seller_id, buyer_id, material, quantity_kg, unit_price, gross_value,
        currency, transport_terms_json, payment_status, payment_id, batch_id,
        status, canonical_digest, receipt_data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindReceiptById = this.db.prepare(`
      SELECT * FROM waste_receipts WHERE id = ?
    `);

    this.stmtFindReceiptByNumber = this.db.prepare(`
      SELECT * FROM waste_receipts WHERE receipt_number = ?
    `);

    this.stmtFindReceiptByTxnId = this.db.prepare(`
      SELECT * FROM waste_receipts WHERE transaction_id = ?
    `);

    this.stmtFindReceiptByNegotiationId = this.db.prepare(`
      SELECT * FROM waste_receipts WHERE negotiation_id = ?
    `);

    this.stmtListReceiptsByUser = this.db.prepare(`
      SELECT * FROM waste_receipts WHERE seller_id = ? OR buyer_id = ? ORDER BY created_at DESC
    `);

    this.stmtUpdateReceiptPayment = this.db.prepare(`
      UPDATE waste_receipts SET payment_status = ?, payment_id = ?, updated_at = ? WHERE id = ?
    `);

    this.stmtUpdateReceiptBatch = this.db.prepare(`
      UPDATE waste_receipts SET batch_id = ?, updated_at = ? WHERE id = ?
    `);

    this.stmtUpdateReceiptStatus = this.db.prepare(`
      UPDATE waste_receipts SET status = ?, updated_at = ? WHERE id = ?
    `);

    this.stmtResetNegotiations = this.db.prepare(`
      DELETE FROM negotiations
    `);
    this.stmtResetOffers = this.db.prepare(`
      DELETE FROM negotiation_offers
    `);
    this.stmtResetReceipts = this.db.prepare(`
      DELETE FROM waste_receipts
    `);

    // Conversations Statements
    this.stmtInsertConversation = this.db.prepare(`
      INSERT INTO conversations (id, listing_id, seller_id, buyer_id, negotiation_id, subject, last_message_at, last_message_snippet, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindConversationById = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ?
    `);

    this.stmtFindConversationByListingAndBuyer = this.db.prepare(`
      SELECT * FROM conversations WHERE listing_id = ? AND buyer_id = ? LIMIT 1
    `);

    this.stmtListConversationsByUser = this.db.prepare(`
      SELECT * FROM conversations WHERE seller_id = ? OR buyer_id = ? ORDER BY updated_at DESC
    `);

    this.stmtUpdateConversationSnippet = this.db.prepare(`
      UPDATE conversations
      SET last_message_snippet = ?, last_message_at = ?, updated_at = ?
      WHERE id = ?
    `);

    // Messages Statements
    this.stmtInsertMessage = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, recipient_id, sender_role, body, message_type, metadata_json, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtListMessagesByConversation = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
    `);

    this.stmtListMessagesSince = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? AND created_at > ? ORDER BY created_at ASC
    `);

    this.stmtMarkMessagesRead = this.db.prepare(`
      UPDATE messages SET read_at = ? WHERE conversation_id = ? AND recipient_id = ? AND read_at IS NULL
    `);

    this.stmtUnreadMessageCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND read_at IS NULL
    `);

    // Notifications Statements
    this.stmtInsertNotification = this.db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, link, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtListNotifications = this.db.prepare(`
      SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `);

    this.stmtMarkNotificationRead = this.db.prepare(`
      UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?
    `);

    this.stmtUnreadNotificationCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL
    `);

    this.stmtResetConversations = this.db.prepare(`DELETE FROM conversations`);
    this.stmtResetMessages = this.db.prepare(`DELETE FROM messages`);
    this.stmtResetNotifications = this.db.prepare(`DELETE FROM notifications`);

    // Payment Transactions Statements
    this.stmtInsertPaymentTx = this.db.prepare(`
      INSERT INTO payment_transactions (
        id, transaction_ref, order_id, payment_id, listing_id, user_id, buyer_id,
        amount_paise, currency, status, method, signature, error_message,
        idempotency_key, created_at, verified_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindPaymentByOrderId = this.db.prepare(`
      SELECT * FROM payment_transactions WHERE order_id = ?
    `);

    this.stmtFindPaymentByRef = this.db.prepare(`
      SELECT * FROM payment_transactions WHERE transaction_ref = ?
    `);

    this.stmtFindPaymentByPaymentId = this.db.prepare(`
      SELECT * FROM payment_transactions WHERE payment_id = ?
    `);

    this.stmtListPaymentsByListing = this.db.prepare(`
      SELECT * FROM payment_transactions WHERE listing_id = ? ORDER BY created_at DESC
    `);

    this.stmtListPaymentsByUser = this.db.prepare(`
      SELECT * FROM payment_transactions WHERE user_id = ? ORDER BY created_at DESC
    `);

    this.stmtUpdatePaymentStatus = this.db.prepare(`
      UPDATE payment_transactions
      SET status = ?, payment_id = ?, signature = ?, method = ?, error_message = ?, verified_at = ?
      WHERE order_id = ?
    `);

    this.stmtResetPaymentTransactions = this.db.prepare(`DELETE FROM payment_transactions`);

    // Price Observations Statements
    this.stmtInsertPriceObservation = this.db.prepare(`
      INSERT OR REPLACE INTO price_observations (
        id, source_id, source_name, source_url, source_type,
        material, material_form, grade, condition, geographic_scope,
        city, state, pincode, country, price_min_per_kg, price_max_per_kg,
        observed_price, currency, unit, observed_at, retrieved_at,
        expires_at, data_mode, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtListPriceObservations = this.db.prepare(`
      SELECT * FROM price_observations ORDER BY observed_at DESC
    `);

    this.stmtFindPriceObservationsByScope = this.db.prepare(`
      SELECT * FROM price_observations
      WHERE material = ? AND material_form = ?
      ORDER BY observed_at DESC
    `);

    this.stmtResetPriceObservations = this.db.prepare(`DELETE FROM price_observations`);

    // Price Estimate Snapshots Statements
    this.stmtInsertPriceSnapshot = this.db.prepare(`
      INSERT INTO price_estimate_snapshots (
        id, listing_id, user_id, city, state, pincode, material, grade, condition,
        quantity_kg, estimated_min_per_kg, estimated_max_per_kg, reference_price_per_kg,
        estimated_batch_min, estimated_batch_max, source_name, source_type,
        geographic_level, freshness_status, observation_date, retrieval_timestamp,
        is_fallback, disclaimer, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtFindPriceSnapshotsByListing = this.db.prepare(`
      SELECT * FROM price_estimate_snapshots WHERE listing_id = ? ORDER BY created_at DESC
    `);

    this.stmtResetPriceSnapshots = this.db.prepare(`DELETE FROM price_estimate_snapshots`);
  }

  /**
   * Inserts a new user record.
   */
  createUser({
    id,
    name,
    email_normalized,
    password_hash,
    created_at,
    updated_at,
    role = 'SELLER',
    phone = null,
    user_type = null,
    city = null,
    state = null,
    address = null,
    category = null,
    preferred_materials = null,
    purchasing_capacity = null,
    collection_radius = null,
    preferences_json = null
  }) {
    const cleanRole = (role || 'SELLER').toUpperCase();
    this.stmtInsertUser.run(
      id, name, email_normalized, password_hash, created_at, updated_at,
      cleanRole, phone, user_type, city, state, address, category,
      typeof preferred_materials === 'object' ? JSON.stringify(preferred_materials) : preferred_materials,
      purchasing_capacity, collection_radius,
      typeof preferences_json === 'object' ? JSON.stringify(preferences_json) : preferences_json
    );
    return {
      id, name, email_normalized, created_at, updated_at,
      role: cleanRole, phone, user_type, city, state, address, category,
      preferred_materials, purchasing_capacity, collection_radius, preferences_json
    };
  }

  /**
   * Finds a user by normalized email (includes password_hash for authentication verification).
   */
  findUserByEmail(email_normalized) {
    const row = this.stmtFindUserByEmail.get(email_normalized);
    return row || null;
  }

  /**
   * Finds a sanitized user by ID (strictly excludes password_hash).
   */
  findUserById(id) {
    const row = this.stmtFindUserById.get(id);
    return row || null;
  }

  /**
   * Deletes a user by ID.
   */
  deleteUser(id) {
    return this.stmtDeleteUser.run(id);
  }

  /**
   * Returns total registered users count.
   */
  getUserCount() {
    const row = this.stmtCountUsers.get();
    return row ? Number(row.count) : 0;
  }

  /**
   * Retrieves session data if not expired.
   */
  getSession(sid) {
    const row = this.stmtGetSession.get(sid);
    if (!row) return null;
    if (Number(row.expire) < Date.now()) {
      this.destroySession(sid);
      return null;
    }
    try {
      return JSON.parse(row.sess);
    } catch {
      return null;
    }
  }

  /**
   * Sets or updates session data with an expiration timestamp.
   */
  setSession(sid, sessObj, expireMs) {
    const sessStr = typeof sessObj === 'string' ? sessObj : JSON.stringify(sessObj);
    this.stmtSetSession.run(sid, sessStr, Number(expireMs));
  }

  /**
   * Destroys a session by ID.
   */
  destroySession(sid) {
    this.stmtDestroySession.run(sid);
  }

  /**
   * Cleans up expired sessions.
   */
  cleanExpiredSessions() {
    this.stmtCleanExpiredSessions.run(Date.now());
  }

  // =============================================
  // RECOVERY BATCHES METHODS (Phase 11)
  // =============================================

  _formatBatchRow(row) {
    if (!row) return null;
    return {
      ...row,
      material: row.material_type,
      discrepancy_threshold_pct: 10
    };
  }

  createBatch(batch) {
    const id = batch.id || crypto.randomUUID();
    const createdAt = batch.created_at || new Date().toISOString();
    const updatedAt = batch.updated_at || createdAt;
    const materialType = batch.material_type || batch.material || 'PET Plastic';
    const declaredQty = Number.isFinite(Number(batch.declared_quantity_kg)) ? Number(batch.declared_quantity_kg) : 0;

    this.stmtInsertBatch.run(
      id,
      batch.batch_code,
      batch.listing_id,
      batch.owner_id || null,
      batch.buyer_id || null,
      materialType,
      declaredQty,
      batch.collection_weight_kg !== undefined && batch.collection_weight_kg !== null ? Number(batch.collection_weight_kg) : null,
      batch.receiving_weight_kg !== undefined && batch.receiving_weight_kg !== null ? Number(batch.receiving_weight_kg) : null,
      batch.weight_discrepancy_flagged ? 1 : 0,
      batch.weight_discrepancy_note || null,
      batch.status || 'LISTED',
      createdAt,
      updatedAt
    );
    return this.findBatchById(id);
  }

  findBatchById(id) {
    const row = this.stmtFindBatchById.get(id);
    return this._formatBatchRow(row);
  }

  findBatchByCode(batchCode) {
    const row = this.stmtFindBatchByCode.get(batchCode);
    return this._formatBatchRow(row);
  }

  findBatchByListingId(listingId) {
    const row = this.stmtFindBatchByListingId.get(listingId);
    return this._formatBatchRow(row);
  }

  listBatchesByOwner(ownerId) {
    const rows = this.stmtListBatchesByOwner.all(ownerId);
    return rows.map(r => this._formatBatchRow(r));
  }

  updateBatchWeights(id, collOrObj, recv, flagged, note) {
    let collection_weight_kg = null;
    let receiving_weight_kg = null;
    let weight_discrepancy_flagged = 0;
    let weight_discrepancy_note = null;
    let updated_at = new Date().toISOString();

    if (collOrObj && typeof collOrObj === 'object') {
      collection_weight_kg = collOrObj.collection_weight_kg !== undefined && collOrObj.collection_weight_kg !== null ? Number(collOrObj.collection_weight_kg) : null;
      receiving_weight_kg = collOrObj.receiving_weight_kg !== undefined && collOrObj.receiving_weight_kg !== null ? Number(collOrObj.receiving_weight_kg) : null;
      weight_discrepancy_flagged = collOrObj.weight_discrepancy_flagged ? 1 : 0;
      weight_discrepancy_note = collOrObj.weight_discrepancy_note || null;
      updated_at = collOrObj.updated_at || updated_at;
    } else {
      collection_weight_kg = collOrObj !== undefined && collOrObj !== null ? Number(collOrObj) : null;
      receiving_weight_kg = recv !== undefined && recv !== null ? Number(recv) : null;
      weight_discrepancy_flagged = flagged ? 1 : 0;
      weight_discrepancy_note = note || null;
    }

    this.stmtUpdateBatchWeights.run(
      collection_weight_kg,
      receiving_weight_kg,
      weight_discrepancy_flagged,
      weight_discrepancy_note,
      updated_at,
      id
    );
    return this.findBatchById(id);
  }

  updateBatchStatus(id, status, updatedAt) {
    this.stmtUpdateBatchStatus.run(status, updatedAt || new Date().toISOString(), id);
    return this.findBatchById(id);
  }

  updateBatchBuyer(id, buyerId, updatedAt) {
    this.stmtUpdateBatchBuyer.run(buyerId, updatedAt || new Date().toISOString(), id);
    return this.findBatchById(id);
  }

  // =============================================
  // EVIDENCE RECORDS METHODS (Phase 11)
  // =============================================

  _formatEvidenceRow(row) {
    if (!row) return null;
    return {
      ...row,
      file_name: row.storage_filename,
      original_name: row.original_filename,
      review_status: row.status
    };
  }

  createEvidence(evidence) {
    const id = evidence.id || crypto.randomUUID();
    const origFilename = evidence.original_filename || evidence.original_name || 'evidence.jpg';
    const storFilename = evidence.storage_filename || evidence.file_name || 'evidence.jpg';
    const status = evidence.status || evidence.review_status || 'SUBMITTED';
    const createdAt = evidence.created_at || new Date().toISOString();

    this.stmtInsertEvidence.run(
      id,
      evidence.batch_id,
      evidence.category,
      origFilename,
      storFilename,
      evidence.mime_type || 'image/jpeg',
      Number(evidence.file_size) || 0,
      evidence.sha256_hash,
      evidence.uploader_id || evidence.uploaded_by || null,
      evidence.notes || null,
      status,
      evidence.review_notes || null,
      evidence.reviewer_id || null,
      evidence.reviewed_at || null,
      evidence.ai_review_label || evidence.ai_review_status || null,
      evidence.ai_review_explanation || evidence.ai_notes || null,
      createdAt
    );
    return this.findEvidenceById(id);
  }

  listEvidenceByBatch(batchId) {
    const rows = this.stmtListEvidenceByBatch.all(batchId);
    return rows.map(r => this._formatEvidenceRow(r));
  }

  findEvidenceById(id) {
    const row = this.stmtFindEvidenceById.get(id);
    return this._formatEvidenceRow(row);
  }

  updateEvidenceReview(id, statusOrObj, reviewNotes, reviewerId) {
    let status = 'SUBMITTED';
    let review_notes = null;
    let reviewer_id = null;
    let reviewed_at = new Date().toISOString();

    if (statusOrObj && typeof statusOrObj === 'object') {
      status = statusOrObj.status || status;
      review_notes = statusOrObj.review_notes || null;
      reviewer_id = statusOrObj.reviewer_id || null;
      reviewed_at = statusOrObj.reviewed_at || reviewed_at;
    } else {
      status = statusOrObj || status;
      review_notes = reviewNotes || null;
      reviewer_id = reviewerId || null;
    }

    this.stmtUpdateEvidenceReview.run(
      status,
      review_notes,
      reviewer_id,
      reviewed_at,
      id
    );
    return this.findEvidenceById(id);
  }

  updateEvidenceAiReview(id, { ai_review_label, ai_review_explanation }) {
    this.stmtUpdateEvidenceAiReview.run(
      ai_review_label || null,
      ai_review_explanation || null,
      id
    );
    return this.findEvidenceById(id);
  }

  // =============================================
  // AUDIT EVENTS METHODS (Phase 11)
  // =============================================

  createAuditEvent(event) {
    const id = event.id || crypto.randomUUID();
    const createdAt = event.created_at || new Date().toISOString();

    this.stmtInsertAuditEvent.run(
      id,
      event.batch_id,
      event.sequence,
      event.event_type,
      event.actor_id || 'System',
      event.previous_value || null,
      event.new_value || null,
      event.explanation || null,
      event.evidence_id || null,
      event.previous_hash,
      event.event_hash,
      createdAt
    );
    return { ...event, id, created_at: createdAt };
  }

  listAuditEventsByBatch(batchId) {
    return this.stmtListAuditEventsByBatch.all(batchId);
  }

  getLastAuditEvent(batchId) {
    const row = this.stmtGetLastAuditEvent.get(batchId);
    return row || null;
  }

  // =============================================
  // NEGOTIATION & OFFER METHODS
  // =============================================

  createNegotiation({ id, listing_id, seller_id, buyer_id, status = 'PENDING', current_offer_id = null, created_at = new Date().toISOString(), updated_at = null }) {
    const negId = id || `neg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = created_at;
    const upd = updated_at || now;
    this.stmtInsertNegotiation.run(negId, listing_id, seller_id, buyer_id, status, current_offer_id, now, upd);
    return this.findNegotiationById(negId);
  }

  findNegotiationById(id) {
    const row = this.stmtFindNegotiationById.get(id);
    return row || null;
  }

  findNegotiationByListingAndBuyer(listing_id, buyer_id) {
    const row = this.stmtFindNegotiationByListingAndBuyer.get(listing_id, buyer_id);
    return row || null;
  }

  listNegotiationsByUser(userId) {
    return this.stmtListNegotiationsByUser.all(userId, userId);
  }

  updateNegotiationStatus(id, status, currentOfferId = null, updatedAt = new Date().toISOString()) {
    this.stmtUpdateNegotiationStatus.run(status, currentOfferId, updatedAt, id);
    return this.findNegotiationById(id);
  }

  createOffer({
    id, negotiation_id, revision_number = 1, offered_by_user_id, offered_by_role = 'SELLER',
    price_per_kg, quantity_kg, total_value = null, currency = 'INR', message = null,
    terms_json = null, status = 'PENDING', expires_at = null, created_at = new Date().toISOString()
  }) {
    const offerId = id || `off_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const price = Number(price_per_kg) || 0;
    const qty = Number(quantity_kg) || 0;
    const val = total_value !== null ? Number(total_value) : Math.round(price * qty * 100) / 100;
    const terms = typeof terms_json === 'object' && terms_json !== null ? JSON.stringify(terms_json) : (terms_json || null);

    this.stmtInsertOffer.run(
      offerId, negotiation_id, Number(revision_number), offered_by_user_id, offered_by_role,
      price, qty, val, currency, message || null, terms, status, expires_at || null, created_at
    );
    return this.findOfferById(offerId);
  }

  findOfferById(id) {
    const row = this.stmtFindOfferById.get(id);
    if (!row) return null;
    return {
      ...row,
      terms: row.terms_json ? JSON.parse(row.terms_json) : null
    };
  }

  listOffersByNegotiation(negotiationId) {
    const rows = this.stmtListOffersByNegotiation.all(negotiationId);
    return rows.map(r => ({
      ...r,
      terms: r.terms_json ? JSON.parse(r.terms_json) : null
    }));
  }

  getLatestOffer(negotiationId) {
    const row = this.stmtGetLatestOffer.get(negotiationId);
    if (!row) return null;
    return {
      ...row,
      terms: row.terms_json ? JSON.parse(row.terms_json) : null
    };
  }

  updateOfferStatus(id, status) {
    this.stmtUpdateOfferStatus.run(status, id);
    return this.findOfferById(id);
  }

  // =============================================
  // WASTE RECEIPT METHODS
  // =============================================

  createReceipt({
    id, receipt_number, transaction_id, negotiation_id, offer_id, listing_id,
    seller_id, buyer_id, material = 'PET Plastic', quantity_kg, unit_price,
    gross_value, currency = 'INR', transport_terms_json = null, payment_status = 'PENDING',
    payment_id = null, batch_id = null, status = 'AGREEMENT_CONFIRMED',
    canonical_digest, receipt_data_json, created_at = new Date().toISOString(), updated_at = null
  }) {
    const rId = id || `rcp_id_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = created_at;
    const upd = updated_at || now;
    const transportTerms = typeof transport_terms_json === 'object' && transport_terms_json !== null ? JSON.stringify(transport_terms_json) : (transport_terms_json || null);
    const receiptData = typeof receipt_data_json === 'object' && receipt_data_json !== null ? JSON.stringify(receipt_data_json) : (receipt_data_json || '{}');

    this.stmtInsertReceipt.run(
      rId, receipt_number, transaction_id, negotiation_id, offer_id, listing_id,
      seller_id, buyer_id, material, Number(quantity_kg), Number(unit_price), Number(gross_value),
      currency, transportTerms, payment_status, payment_id, batch_id,
      status, canonical_digest, receiptData, now, upd
    );
    return this.findReceiptById(rId);
  }

  findReceiptById(id) {
    const row = this.stmtFindReceiptById.get(id);
    if (!row) return null;
    return {
      ...row,
      transport_terms: row.transport_terms_json ? JSON.parse(row.transport_terms_json) : null,
      receipt_data: row.receipt_data_json ? JSON.parse(row.receipt_data_json) : null
    };
  }

  findReceiptByNumber(receiptNumber) {
    const row = this.stmtFindReceiptByNumber.get(receiptNumber);
    if (!row) return null;
    return {
      ...row,
      transport_terms: row.transport_terms_json ? JSON.parse(row.transport_terms_json) : null,
      receipt_data: row.receipt_data_json ? JSON.parse(row.receipt_data_json) : null
    };
  }

  findReceiptByTxnId(txnId) {
    const row = this.stmtFindReceiptByTxnId.get(txnId);
    if (!row) return null;
    return {
      ...row,
      transport_terms: row.transport_terms_json ? JSON.parse(row.transport_terms_json) : null,
      receipt_data: row.receipt_data_json ? JSON.parse(row.receipt_data_json) : null
    };
  }

  findReceiptByNegotiationId(negotiationId) {
    const row = this.stmtFindReceiptByNegotiationId.get(negotiationId);
    if (!row) return null;
    return {
      ...row,
      transport_terms: row.transport_terms_json ? JSON.parse(row.transport_terms_json) : null,
      receipt_data: row.receipt_data_json ? JSON.parse(row.receipt_data_json) : null
    };
  }

  listReceiptsByUser(userId) {
    const rows = this.stmtListReceiptsByUser.all(userId, userId);
    return rows.map(r => ({
      ...r,
      transport_terms: r.transport_terms_json ? JSON.parse(r.transport_terms_json) : null,
      receipt_data: r.receipt_data_json ? JSON.parse(r.receipt_data_json) : null
    }));
  }

  updateReceiptPayment(id, paymentStatus, paymentId = null, updatedAt = new Date().toISOString()) {
    this.stmtUpdateReceiptPayment.run(paymentStatus, paymentId, updatedAt, id);
    return this.findReceiptById(id);
  }

  updateReceiptBatch(id, batchId, updatedAt = new Date().toISOString()) {
    this.stmtUpdateReceiptBatch.run(batchId, updatedAt, id);
    return this.findReceiptById(id);
  }

  updateReceiptStatus(id, status, updatedAt = new Date().toISOString()) {
    this.stmtUpdateReceiptStatus.run(status, updatedAt, id);
    return this.findReceiptById(id);
  }

  updateUserProfile(id, fields = {}) {
    const now = new Date().toISOString();
    this.stmtUpdateUserProfile.run(
      fields.name !== undefined ? fields.name : null,
      fields.phone !== undefined ? fields.phone : null,
      fields.user_type !== undefined ? fields.user_type : null,
      fields.city !== undefined ? fields.city : null,
      fields.state !== undefined ? fields.state : null,
      fields.address !== undefined ? fields.address : null,
      fields.category !== undefined ? fields.category : null,
      fields.preferred_materials !== undefined ? (typeof fields.preferred_materials === 'object' ? JSON.stringify(fields.preferred_materials) : fields.preferred_materials) : null,
      fields.purchasing_capacity !== undefined ? fields.purchasing_capacity : null,
      fields.collection_radius !== undefined ? fields.collection_radius : null,
      fields.preferences_json !== undefined ? (typeof fields.preferences_json === 'object' ? JSON.stringify(fields.preferences_json) : fields.preferences_json) : null,
      now,
      id
    );
    return this.findUserById(id);
  }

  setPasswordResetToken(email_normalized, token, expire) {
    const now = new Date().toISOString();
    const info = this.stmtSetResetToken.run(token, expire, now, email_normalized);
    return info.changes > 0;
  }

  findUserByResetToken(token) {
    const now = Date.now();
    const row = this.stmtFindUserByResetToken.get(token, now);
    return row || null;
  }

  updateUserPassword(id, newPasswordHash) {
    const now = new Date().toISOString();
    const info = this.stmtUpdatePasswordWithReset.run(newPasswordHash, now, id);
    return info.changes > 0;
  }

  // --- In-Platform Conversation Methods ---
  createConversation({
    id,
    listing_id = null,
    seller_id,
    buyer_id,
    negotiation_id = null,
    subject = null,
    last_message_at = null,
    last_message_snippet = null,
    created_at = new Date().toISOString(),
    updated_at = new Date().toISOString()
  }) {
    this.stmtInsertConversation.run(
      id, listing_id, seller_id, buyer_id, negotiation_id, subject,
      last_message_at, last_message_snippet, created_at, updated_at
    );
    return this.findConversationById(id);
  }

  findConversationById(id) {
    const row = this.stmtFindConversationById.get(id);
    return row || null;
  }

  findConversationByListingAndBuyer(listing_id, buyer_id) {
    if (!listing_id || !buyer_id) return null;
    const row = this.stmtFindConversationByListingAndBuyer.get(listing_id, buyer_id);
    return row || null;
  }

  listConversationsByUser(user_id) {
    return this.stmtListConversationsByUser.all(user_id, user_id);
  }

  updateConversationSnippet(id, snippet, at = new Date().toISOString()) {
    this.stmtUpdateConversationSnippet.run(snippet, at, at, id);
    return this.findConversationById(id);
  }

  // --- In-Platform Message Methods ---
  createMessage({
    id,
    conversation_id,
    sender_id,
    recipient_id,
    sender_role = 'SELLER',
    body,
    message_type = 'TEXT',
    metadata_json = null,
    read_at = null,
    created_at = new Date().toISOString()
  }) {
    this.stmtInsertMessage.run(
      id, conversation_id, sender_id, recipient_id, sender_role, body,
      message_type, metadata_json, read_at, created_at
    );
    this.updateConversationSnippet(conversation_id, body.substring(0, 80), created_at);
    return {
      id, conversation_id, sender_id, recipient_id, sender_role, body,
      message_type, metadata_json, read_at, created_at
    };
  }

  listMessagesByConversation(conversation_id, since = null) {
    if (since) {
      return this.stmtListMessagesSince.all(conversation_id, since);
    }
    return this.stmtListMessagesByConversation.all(conversation_id);
  }

  markMessagesRead(conversation_id, recipient_id, read_at = new Date().toISOString()) {
    const info = this.stmtMarkMessagesRead.run(read_at, conversation_id, recipient_id);
    return info.changes;
  }

  getUnreadMessageCountByUser(user_id) {
    const row = this.stmtUnreadMessageCount.get(user_id);
    return row ? row.count : 0;
  }

  // --- In-App Notification Methods ---
  createNotification({
    id,
    user_id,
    type,
    title,
    body,
    link = null,
    read_at = null,
    created_at = new Date().toISOString()
  }) {
    this.stmtInsertNotification.run(id, user_id, type, title, body, link, read_at, created_at);
    return { id, user_id, type, title, body, link, read_at, created_at };
  }

  listNotificationsByUser(user_id, limit = 20) {
    return this.stmtListNotifications.all(user_id, limit);
  }

  markNotificationRead(id, user_id, read_at = new Date().toISOString()) {
    const info = this.stmtMarkNotificationRead.run(read_at, id, user_id);
    return info.changes > 0;
  }

  getUnreadNotificationCountByUser(user_id) {
    const row = this.stmtUnreadNotificationCount.get(user_id);
    return row ? row.count : 0;
  }

  createPaymentTransaction({
    id,
    transaction_ref,
    order_id,
    payment_id = null,
    listing_id = null,
    user_id = null,
    buyer_id = null,
    amount_paise,
    currency = 'INR',
    status = 'ORDER_CREATED',
    method = null,
    signature = null,
    error_message = null,
    idempotency_key = null,
    created_at = new Date().toISOString(),
    verified_at = null,
    metadata_json = null
  }) {
    const finalId = id || transaction_ref || `ptx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this.stmtInsertPaymentTx.run(
      finalId, transaction_ref, order_id, payment_id, listing_id, user_id, buyer_id,
      amount_paise, currency, status, method, signature, error_message,
      idempotency_key, created_at, verified_at,
      typeof metadata_json === 'object' && metadata_json !== null ? JSON.stringify(metadata_json) : metadata_json
    );
    return this.findPaymentTransactionByOrderId(order_id);
  }

  findPaymentTransactionByOrderId(orderId) {
    return this.stmtFindPaymentByOrderId.get(orderId) || null;
  }

  findPaymentTransactionByRef(ref) {
    return this.stmtFindPaymentByRef.get(ref) || null;
  }

  findPaymentTransactionByPaymentId(paymentId) {
    return this.stmtFindPaymentByPaymentId.get(paymentId) || null;
  }

  listPaymentTransactionsByListing(listingId) {
    return this.stmtListPaymentsByListing.all(listingId);
  }

  listPaymentTransactionsByUser(userId) {
    return this.stmtListPaymentsByUser.all(userId);
  }

  updatePaymentTransactionStatus(orderId, options = {}) {
    const status = options.status;
    const payment_id = options.payment_id !== undefined ? options.payment_id : (options.paymentId !== undefined ? options.paymentId : null);
    const signature = options.signature !== undefined ? options.signature : null;
    const method = options.method !== undefined ? options.method : null;
    const error_message = options.error_message !== undefined ? options.error_message : (options.errorMessage !== undefined ? options.errorMessage : null);
    const verified_at = options.verified_at !== undefined ? options.verified_at : (options.verifiedAt !== undefined ? options.verifiedAt : (status === 'PAYMENT_VERIFIED' ? new Date().toISOString() : null));

    this.stmtUpdatePaymentStatus.run(
      status, payment_id, signature, method, error_message, verified_at, orderId
    );
    return this.findPaymentTransactionByOrderId(orderId);
  }

  resetPaymentTransactions() {
    this.stmtResetPaymentTransactions.run();
  }

  // --- Price Intelligence Operations ---
  recordPriceObservation(obs) {
    const id = obs.id || `pobs_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const observed_at = obs.observed_at || new Date().toISOString();
    const retrieved_at = obs.retrieved_at || new Date().toISOString();
    const created_at = obs.created_at || new Date().toISOString();

    this.stmtInsertPriceObservation.run(
      id,
      obs.source_id || 'manual',
      obs.source_name,
      obs.source_url || null,
      obs.source_type || 'SCRAP_INDEX',
      obs.material || 'PET Plastic',
      obs.material_form || 'used_beverage_bottles',
      obs.grade,
      obs.condition || 'Clean',
      obs.geographic_scope || 'REGIONAL',
      obs.city || null,
      obs.state || null,
      obs.pincode || null,
      obs.country || 'India',
      Number(obs.price_min_per_kg),
      Number(obs.price_max_per_kg),
      obs.observed_price !== undefined && obs.observed_price !== null ? Number(obs.observed_price) : null,
      obs.currency || 'INR',
      obs.unit || 'kg',
      observed_at,
      retrieved_at,
      obs.expires_at || null,
      obs.data_mode || 'LIVE',
      obs.notes || null,
      created_at
    );

    return { ...obs, id, observed_at, retrieved_at, created_at };
  }

  listPriceObservations() {
    return this.stmtListPriceObservations.all();
  }

  resetPriceObservations() {
    this.stmtResetPriceObservations.run();
  }

  recordPriceSnapshot(snap) {
    const id = snap.id || `psnap_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const created_at = snap.created_at || new Date().toISOString();

    this.stmtInsertPriceSnapshot.run(
      id,
      snap.listing_id || null,
      snap.user_id || null,
      snap.city || null,
      snap.state || null,
      snap.pincode || null,
      snap.material || 'PET Plastic',
      snap.grade || 'Post-consumer clear PET bottles',
      snap.condition || 'Clean',
      Number(snap.quantity_kg),
      Number(snap.estimated_min_per_kg),
      Number(snap.estimated_max_per_kg),
      Number(snap.reference_price_per_kg),
      Number(snap.estimated_batch_min),
      Number(snap.estimated_batch_max),
      snap.source_name || 'Price Intelligence Engine',
      snap.source_type || 'REGIONAL_BENCHMARK',
      snap.geographic_level || 'city',
      snap.freshness_status || 'FRESH',
      snap.observation_date || new Date().toISOString(),
      snap.retrieval_timestamp || new Date().toISOString(),
      snap.is_fallback ? 1 : 0,
      snap.disclaimer || null,
      created_at
    );

    return { ...snap, id, created_at };
  }

  findPriceSnapshotsByListing(listingId) {
    return this.stmtFindPriceSnapshotsByListing.all(listingId);
  }

  resetPriceSnapshots() {
    this.stmtResetPriceSnapshots.run();
  }

  resetConversations() {
    this.stmtResetMessages.run();
    this.stmtResetConversations.run();
  }

  resetNotifications() {
    this.stmtResetNotifications.run();
  }

  resetNegotiations() {
    this.stmtResetOffers.run();
    this.stmtResetNegotiations.run();
  }

  resetReceipts() {
    this.stmtResetReceipts.run();
  }

  /**
   * Resets Phase 11 tables for tests.
   */
  resetBatches() {
    this.stmtResetAudit.run();
    this.stmtResetEvidence.run();
    this.stmtResetBatches.run();
  }

  /**
   * Development/test helper: resets all users.
   */
  resetUsers() {
    this.stmtResetAll.run();
    this.resetBatches();
    this.resetNegotiations();
    this.resetReceipts();
    this.resetConversations();
    this.resetNotifications();
    this.resetPaymentTransactions();
  }

  /**
   * Closes database connection.
   */
  close() {
    try {
      this.db.close();
    } catch {
      // Ignored if already closed
    }
  }
}

// Default singleton instance
const defaultDb = new AuthDatabase();

module.exports = {
  AuthDatabase,
  defaultDb
};

