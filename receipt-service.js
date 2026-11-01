/**
 * EcoCycle AI — Digital Waste Transaction Receipt Service Module
 *
 * Implements:
 * 1. Digital receipt creation on agreed waste transaction / offer acceptance.
 * 2. Canonical JSON string generation & SHA-256 tamper-evident digest.
 * 3. Immutable commercial term recording.
 * 4. Separate tracking of commercial agreement vs physical recovery vs payment state.
 * 5. Cryptographic digest verification.
 * 6. Sanitized public verification view (privacy preserving).
 */

const crypto = require('crypto');

const RECEIPT_DISCLAIMER =
  'This digital receipt certifies an agreed commercial recycling transaction between the parties named above. It records the agreed quantity, price, and terms at the time of agreement. Physical collection, actual weigh-in verification, and downstream recycling are tracked independently through the linked EcoProof recovery lifecycle.';

/**
 * Generates a unique, professional receipt number (e.g. RCP-2026-8B4F-9C12).
 */
function generateReceiptNumber() {
  const year = new Date().getFullYear();
  const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RCP-${year}-${part1}-${part2}`;
}

/**
 * Generates a unique transaction identifier (e.g. TXN-PET-2026-A1B2C3).
 */
function generateTransactionId() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TXN-PET-${year}-${rand}`;
}

/**
 * Produces a canonical string representation for hashing and tamper-detection.
 * Keys are deterministically sorted.
 */
function createCanonicalReceiptPayload({
  receipt_number,
  transaction_id,
  negotiation_id,
  offer_id,
  listing_id,
  seller_id,
  buyer_id,
  material,
  quantity_kg,
  unit_price,
  gross_value,
  currency,
  created_at
}) {
  const canonicalObj = {
    buyer_id: String(buyer_id),
    created_at: String(created_at),
    currency: String(currency || 'INR'),
    gross_value: Number(gross_value).toFixed(2),
    listing_id: String(listing_id),
    material: String(material || 'PET Plastic'),
    negotiation_id: String(negotiation_id),
    offer_id: String(offer_id),
    quantity_kg: Number(quantity_kg).toFixed(2),
    receipt_number: String(receipt_number),
    seller_id: String(seller_id),
    transaction_id: String(transaction_id),
    unit_price: Number(unit_price).toFixed(2)
  };

  return JSON.stringify(canonicalObj, Object.keys(canonicalObj).sort());
}

/**
 * Computes SHA-256 digest of canonical receipt payload.
 */
function computeReceiptDigest(canonicalPayload) {
  return crypto.createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

/**
 * Generates a complete digital waste transaction receipt record.
 */
function issueReceipt({
  negotiation,
  offer,
  listing,
  sellerUser,
  buyerProfile,
  transportFeasibility = null,
  paymentRecord = null,
  recoveryBatch = null
}) {
  const receiptNumber = generateReceiptNumber();
  const transactionId = generateTransactionId();
  const createdAt = new Date().toISOString();

  const quantityKg = Number(offer.quantity_kg);
  const unitPrice = Number(offer.price_per_kg);
  const grossValue = Math.round((quantityKg * unitPrice) * 100) / 100;
  const currency = offer.currency || 'INR';

  const canonicalPayload = createCanonicalReceiptPayload({
    receipt_number: receiptNumber,
    transaction_id: transactionId,
    negotiation_id: negotiation.id,
    offer_id: offer.id,
    listing_id: listing.id,
    seller_id: negotiation.seller_id,
    buyer_id: negotiation.buyer_id,
    material: listing.confirmed_material || 'PET Plastic',
    quantity_kg: quantityKg,
    unit_price: unitPrice,
    gross_value: grossValue,
    currency,
    created_at: createdAt
  });

  const canonicalDigest = computeReceiptDigest(canonicalPayload);

  // Transport terms summary
  const transportTerms = {
    mode: offer.terms && offer.terms.transport_mode ? offer.terms.transport_mode : 'RECYCLER_PICKUP',
    estimated_cost: transportFeasibility ? transportFeasibility.estimated_transport_cost : null,
    distance_km: transportFeasibility ? transportFeasibility.distance_km : null,
    distance_method: transportFeasibility ? transportFeasibility.distance_method : 'STRAIGHT_LINE_ESTIMATE',
    status: transportFeasibility ? transportFeasibility.status : 'ESTIMATED',
    note: 'Transport charges and pickup schedules are provisional estimates subject to physical dispatch verification.'
  };

  // Full receipt structured data
  const receiptData = {
    receipt_number: receiptNumber,
    transaction_id: transactionId,
    issued_at: createdAt,
    seller: {
      id: sellerUser ? sellerUser.id : negotiation.seller_id,
      name: sellerUser ? sellerUser.name : 'Registered Seller',
      email: sellerUser ? sellerUser.email_normalized : null
    },
    buyer: {
      id: buyerProfile ? buyerProfile.id : negotiation.buyer_id,
      name: buyerProfile ? buyerProfile.name : 'Authorized Recycler Partner',
      supported_zones: buyerProfile ? buyerProfile.supported_zones : []
    },
    listing: {
      id: listing.id,
      material: listing.confirmed_material || 'PET Plastic',
      condition: listing.condition || 'Clean',
      locality: listing.locality || 'Central'
    },
    offer: {
      id: offer.id,
      revision_number: offer.revision_number || 1,
      offered_by_role: offer.offered_by_role || 'SELLER'
    },
    commercial_terms: {
      quantity_kg: quantityKg,
      unit_price: unitPrice,
      gross_value: grossValue,
      currency
    },
    transport: transportTerms,
    lifecycle_states: {
      commercial_agreement: 'AGREEMENT_CONFIRMED',
      payment_status: paymentRecord ? paymentRecord.status : 'PENDING',
      payment_id: paymentRecord ? paymentRecord.payment_id : null,
      recovery_status: recoveryBatch ? recoveryBatch.status : 'LISTED',
      batch_code: recoveryBatch ? recoveryBatch.batch_code : null
    },
    cryptographic_integrity: {
      canonical_algorithm: 'JSON_SORTED_KEYS',
      hash_algorithm: 'SHA-256',
      digest: canonicalDigest
    },
    disclaimer: RECEIPT_DISCLAIMER
  };

  return {
    receipt_number: receiptNumber,
    transaction_id: transactionId,
    negotiation_id: negotiation.id,
    offer_id: offer.id,
    listing_id: listing.id,
    seller_id: negotiation.seller_id,
    buyer_id: negotiation.buyer_id,
    material: listing.confirmed_material || 'PET Plastic',
    quantity_kg: quantityKg,
    unit_price: unitPrice,
    gross_value: grossValue,
    currency,
    transport_terms_json: transportTerms,
    payment_status: paymentRecord ? paymentRecord.status : 'PENDING',
    payment_id: paymentRecord ? paymentRecord.payment_id : null,
    batch_id: recoveryBatch ? recoveryBatch.id : null,
    status: 'AGREEMENT_CONFIRMED',
    canonical_digest: canonicalDigest,
    receipt_data_json: receiptData,
    created_at: createdAt
  };
}

/**
 * Verifies the integrity of a stored receipt by recomputing its canonical digest.
 * Returns { valid: boolean, calculated_digest: string, stored_digest: string }
 */
function verifyReceiptIntegrity(receipt) {
  if (!receipt || !receipt.canonical_digest) {
    return { valid: false, reason: 'Missing receipt record or digest.' };
  }

  const canonicalPayload = createCanonicalReceiptPayload({
    receipt_number: receipt.receipt_number,
    transaction_id: receipt.transaction_id,
    negotiation_id: receipt.negotiation_id,
    offer_id: receipt.offer_id,
    listing_id: receipt.listing_id,
    seller_id: receipt.seller_id,
    buyer_id: receipt.buyer_id,
    material: receipt.material,
    quantity_kg: receipt.quantity_kg,
    unit_price: receipt.unit_price,
    gross_value: receipt.gross_value,
    currency: receipt.currency,
    created_at: receipt.created_at
  });

  const calculatedDigest = computeReceiptDigest(canonicalPayload);
  const isValid = crypto.timingSafeEqual(
    Buffer.from(calculatedDigest, 'utf8'),
    Buffer.from(receipt.canonical_digest, 'utf8')
  );

  return {
    valid: isValid,
    calculated_digest: calculatedDigest,
    stored_digest: receipt.canonical_digest,
    status: isValid ? 'VALID' : 'TAMPERED'
  };
}

/**
 * Returns a strictly sanitized public verification representation.
 * Excludes personal names, email addresses, exact GPS coordinates, session IDs, and payment secrets.
 */
function getSanitizedPublicReceipt(receipt) {
  if (!receipt) return null;

  const integrity = verifyReceiptIntegrity(receipt);

  return {
    receipt_number: receipt.receipt_number,
    transaction_id: receipt.transaction_id,
    material: receipt.material,
    quantity_kg: receipt.quantity_kg,
    currency: receipt.currency,
    status: receipt.status,
    payment_status: receipt.payment_status,
    issued_at: receipt.created_at,
    integrity_status: integrity.status,
    sha256_digest: receipt.canonical_digest,
    disclaimer: RECEIPT_DISCLAIMER
  };
}

module.exports = {
  issueReceipt,
  createCanonicalReceiptPayload,
  computeReceiptDigest,
  verifyReceiptIntegrity,
  getSanitizedPublicReceipt,
  generateReceiptNumber,
  generateTransactionId,
  RECEIPT_DISCLAIMER
};

