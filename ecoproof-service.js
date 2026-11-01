/**
 * EcoCycle AI — EcoProof Loop Service Module
 *
 * Implements:
 * 1. Recovery Batch initialization & unique human-readable code generation.
 * 2. Hash-Chained Audit Trail (SHA-256 tamper-evident event log).
 * 3. Evidence Completeness Scoring (0-100 deterministic model).
 * 4. Weight Discrepancy Detection (10% tolerance threshold).
 * 5. Public Traceability Data Sanitization.
 * 6. QR Code Generation for batch traceability.
 * 7. Optional AI-Assisted Evidence Verification via Gemini.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');

const EVIDENCE_CATEGORIES = [
  'PICKUP_PHOTO',
  'COLLECTION_WEIGHT',
  'RECEIVER_CONFIRMATION',
  'RECEIVING_WEIGHT',
  'PROCESSING_EVIDENCE'
];

const CATEGORY_WEIGHTS = {
  PICKUP_PHOTO: 20,
  COLLECTION_WEIGHT: 20,
  RECEIVER_CONFIRMATION: 20,
  RECEIVING_WEIGHT: 20,
  PROCESSING_EVIDENCE: 20
};

const DEFAULT_DISCREPANCY_THRESHOLD_PERCENT = 10.0;

const EVIDENCE_DISCLAIMER =
  'Transparency Disclaimer: Evidence completeness measures the presence of supporting records only. It does not independently prove that recycling or downstream processing occurred without third-party physical chain-of-custody verification.';

/**
 * Generates a unique, human-readable batch code (e.g. ECO-PET-2026-A8F2).
 */
function generateBatchCode() {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ECO-PET-${year}-${rand}`;
}

/**
 * Computes SHA-256 hash of a buffer or string.
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Records a hash-chained audit event into the database.
 * Every event references the SHA-256 hash of the immediately preceding event,
 * creating an immutable sequence verifiable via `verifyAuditChain`.
 */
function recordAuditEvent(db, {
  batchId,
  eventType,
  actorId = 'System',
  previousValue = null,
  newValue = null,
  explanation = null,
  evidenceId = null
}) {
  const lastEvent = db.getLastAuditEvent(batchId);
  const sequence = lastEvent ? lastEvent.sequence + 1 : 1;
  const previousHash = lastEvent ? lastEvent.event_hash : '0'.repeat(64); // Genesis hash
  const createdAt = new Date().toISOString();

  // Canonical representation for cryptographic chain integrity
  const prevValStr = typeof previousValue === 'object' && previousValue !== null ? JSON.stringify(previousValue) : String(previousValue || '');
  const newValStr = typeof newValue === 'object' && newValue !== null ? JSON.stringify(newValue) : String(newValue || '');
  const explStr = typeof explanation === 'string' ? explanation : '';
  const canonical = `${batchId}|${sequence}|${eventType}|${actorId}|${previousHash}|${createdAt}|${prevValStr}|${newValStr}|${explStr}`;
  const eventHash = sha256(canonical);

  const eventRecord = {
    id: `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    batch_id: batchId,
    sequence,
    event_type: eventType,
    actor_id: actorId,
    previous_value: prevValStr || null,
    new_value: newValStr || null,
    explanation,
    evidence_id: evidenceId || null,
    previous_hash: previousHash,
    event_hash: eventHash,
    created_at: createdAt
  };

  db.createAuditEvent(eventRecord);
  return eventRecord;
}

/**
 * Verifies the integrity of the audit event hash-chain for a given batch.
 */
function verifyAuditChain(eventsOrDb, batchId) {
  let events;
  if (Array.isArray(eventsOrDb)) {
    events = eventsOrDb;
  } else if (eventsOrDb && typeof eventsOrDb.listAuditEventsByBatch === 'function') {
    events = eventsOrDb.listAuditEventsByBatch(batchId);
  } else {
    events = [];
  }

  if (!events || events.length === 0) {
    return { valid: true, eventCount: 0, error: null };
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const expectedSequence = i + 1;

    if (ev.sequence !== expectedSequence) {
      return {
        valid: false,
        invalidIndex: i,
        eventCount: events.length,
        error: `Sequence broken at index ${i}: expected ${expectedSequence}, got ${ev.sequence}`
      };
    }

    const expectedPrevHash = i === 0 ? '0'.repeat(64) : events[i - 1].event_hash;
    if (ev.previous_hash !== expectedPrevHash) {
      return {
        valid: false,
        invalidIndex: i,
        eventCount: events.length,
        error: `Hash chain broken at sequence ${ev.sequence}: previous_hash does not match predecessor`
      };
    }

    const prevValStr = ev.previous_value || '';
    const newValStr = ev.new_value || '';
    const explStr = typeof ev.explanation === 'string' ? ev.explanation : '';
    const canonical = `${ev.batch_id}|${ev.sequence}|${ev.event_type}|${ev.actor_id}|${ev.previous_hash}|${ev.created_at}|${prevValStr}|${newValStr}|${explStr}`;
    const calculatedHash = sha256(canonical);

    if (calculatedHash !== ev.event_hash) {
      return {
        valid: false,
        invalidIndex: i,
        eventCount: events.length,
        error: `Content hash verification failed at sequence ${ev.sequence}`
      };
    }
  }

  return { valid: true, eventCount: events.length, error: null };
}

/**
 * Calculates evidence completeness score (0 - 100) and milestone statuses.
 *
 * Scoring model:
 * - 5 distinct milestones, each contributing 20 points.
 * - SUBMITTED or REVIEWED earns 20 points.
 * - FLAGGED earns 0 points.
 * - Unsubmitted milestones are marked MISSING or NOT_YET_DUE based on the lifecycle stage.
 */
function calculateEvidenceScore(batch, evidenceList = []) {
  const milestones = [];
  let totalScore = 0;

  const currentStatus = batch ? (batch.status || 'LISTED') : 'LISTED';

  for (const cat of EVIDENCE_CATEGORIES) {
    const items = evidenceList.filter(e => e.category === cat);
    let milestoneStatus = 'MISSING';
    let earnedPoints = 0;
    let evidenceId = null;
    let reviewNotes = null;
    let aiReview = null;

    if (items.length > 0) {
      // Prioritize reviewed, then submitted
      const reviewedItem = items.find(i => i.status === 'REVIEWED' || i.review_status === 'REVIEWED');
      const flaggedItem = items.find(i => i.status === 'FLAGGED' || i.review_status === 'FLAGGED');
      const submittedItem = items.find(i => i.status === 'SUBMITTED' || i.review_status === 'SUBMITTED');

      if (reviewedItem) {
        milestoneStatus = 'REVIEWED';
        earnedPoints = CATEGORY_WEIGHTS[cat];
        evidenceId = reviewedItem.id;
        reviewNotes = reviewedItem.review_notes;
        aiReview = reviewedItem.ai_review_label;
      } else if (flaggedItem) {
        milestoneStatus = 'FLAGGED';
        earnedPoints = 0;
        evidenceId = flaggedItem.id;
        reviewNotes = flaggedItem.review_notes;
        aiReview = flaggedItem.ai_review_label;
      } else if (submittedItem) {
        milestoneStatus = 'SUBMITTED';
        earnedPoints = CATEGORY_WEIGHTS[cat];
        evidenceId = submittedItem.id;
        reviewNotes = submittedItem.review_notes;
        aiReview = submittedItem.ai_review_label;
      }
    } else {
      // Evaluate if milestone is not yet due based on recovery lifecycle
      if (currentStatus === 'LISTED') {
        if (cat === 'RECEIVER_CONFIRMATION' || cat === 'RECEIVING_WEIGHT' || cat === 'PROCESSING_EVIDENCE') {
          milestoneStatus = 'NOT_YET_DUE';
        }
      } else if (currentStatus === 'MATCHED') {
        if (cat === 'RECEIVING_WEIGHT' || cat === 'PROCESSING_EVIDENCE') {
          milestoneStatus = 'NOT_YET_DUE';
        }
      } else if (currentStatus === 'COLLECTION_CONFIRMED') {
        if (cat === 'PROCESSING_EVIDENCE') {
          milestoneStatus = 'NOT_YET_DUE';
        }
      }
    }

    totalScore += earnedPoints;

    milestones.push({
      category: cat,
      label: formatCategoryLabel(cat),
      status: milestoneStatus,
      weight: CATEGORY_WEIGHTS[cat],
      maxPoints: CATEGORY_WEIGHTS[cat],
      earned: earnedPoints,
      awardedPoints: earnedPoints,
      evidence_id: evidenceId,
      review_notes: reviewNotes,
      ai_review: aiReview
    });
  }

  const finalScore = Math.min(100, Math.max(0, totalScore));

  return {
    score: finalScore,
    totalScore: finalScore,
    disclaimer: EVIDENCE_DISCLAIMER,
    milestones,
    breakdown: milestones,
    submitted_count: milestones.filter(m => m.status === 'SUBMITTED' || m.status === 'REVIEWED').length,
    missing_count: milestones.filter(m => m.status === 'MISSING').length,
    not_due_count: milestones.filter(m => m.status === 'NOT_YET_DUE').length,
    flagged_count: milestones.filter(m => m.status === 'FLAGGED').length
  };
}

function formatCategoryLabel(cat) {
  switch (cat) {
    case 'PICKUP_PHOTO': return 'Collection Photograph';
    case 'COLLECTION_WEIGHT': return 'Collection Weight Scale Record';
    case 'RECEIVER_CONFIRMATION': return 'Receiving Party Confirmation';
    case 'RECEIVING_WEIGHT': return 'Receiving Weight Scale Record';
    case 'PROCESSING_EVIDENCE': return 'Downstream Reprocessing Evidence';
    default: return cat;
  }
}

/**
 * Calculates weight difference in kg and percentage, flagging batches when
 * difference exceeds the configurable threshold (default: 10%).
 */
function calculateWeightDiscrepancy(collectionWeightKg, receivingWeightKg, thresholdPercent = DEFAULT_DISCREPANCY_THRESHOLD_PERCENT) {
  if (
    collectionWeightKg === null || collectionWeightKg === undefined ||
    receivingWeightKg === null || receivingWeightKg === undefined
  ) {
    return {
      isCalculable: false,
      flagged: false,
      differenceKg: null,
      differencePercent: null,
      discrepancyPercent: null,
      thresholdPercent,
      status: 'PENDING_WEIGHTS',
      message: 'Both collection and receiving weights must be recorded to evaluate weight discrepancy.'
    };
  }

  const coll = Number(collectionWeightKg);
  const recv = Number(receivingWeightKg);

  if (!Number.isFinite(coll) || coll <= 0 || !Number.isFinite(recv) || recv <= 0) {
    return {
      isCalculable: false,
      flagged: false,
      differenceKg: null,
      differencePercent: null,
      discrepancyPercent: null,
      thresholdPercent,
      status: 'INVALID_WEIGHTS',
      message: 'Recorded weights must be positive finite numbers.'
    };
  }

  const diffKg = Math.round((recv - coll) * 100) / 100;
  const diffPercent = Math.round((Math.abs(recv - coll) / coll) * 10000) / 100;
  const flagged = diffPercent > thresholdPercent;

  return {
    isCalculable: true,
    flagged,
    differenceKg: diffKg,
    differencePercent: diffPercent,
    discrepancyPercent: diffPercent,
    thresholdPercent,
    status: flagged ? 'FLAGGED' : 'ACCEPTABLE',
    message: flagged
      ? `Weight discrepancy detected. The recorded receiving weight differs from the collection weight by ${diffPercent}% (exceeding ${thresholdPercent}% tolerance). Please review the records.`
      : `Weights are consistent within the allowed ${thresholdPercent}% tolerance.`
  };
}

/**
 * Filters and sanitizes batch records for public QR traceability view.
 * Strictly strips:
 * - Passwords, hashes, sessions
 * - Private email addresses, user names, phone numbers
 * - Exact pickup GPS coordinates & street addresses
 * - Private evidence storage filenames
 * - Payment secrets & transaction IDs
 */
function sanitizePublicBatchView(batch, evidenceList = [], auditEvents = [], scoreResult = null, discrepancyResult = null, publicOrigin = '') {
  if (!batch) return null;

  const score = scoreResult || calculateEvidenceScore(batch, evidenceList);
  const discrepancy = discrepancyResult || calculateWeightDiscrepancy(batch.collection_weight_kg, batch.receiving_weight_kg);

  // Filter public timeline events (remove internal IDs, actors generalized)
  const publicTimeline = (auditEvents || []).map(e => ({
    sequence: e.sequence,
    event_type: e.event_type,
    label: formatPublicEventLabel(e.event_type),
    timestamp: e.created_at,
    explanation: e.explanation || null
  }));

  // Summarize evidence milestones without exposing raw storage keys or user IDs
  const publicEvidenceSummary = score.milestones.map(m => ({
    category: m.category,
    label: m.label,
    status: m.status,
    earned_weight: m.earned,
    max_weight: m.weight
  }));

  const traceUrl = `${publicOrigin}/trace/${encodeURIComponent(batch.batch_code)}`;

  return {
    batch_code: batch.batch_code,
    batchCode: batch.batch_code,
    material: batch.material_type || batch.material || 'PET Plastic',
    material_type: batch.material_type || batch.material || 'PET Plastic',
    materialType: batch.material_type || batch.material || 'PET Plastic',
    declared_quantity_kg: batch.declared_quantity_kg,
    declaredQuantityKg: batch.declared_quantity_kg,
    status: batch.status,
    created_at: batch.created_at,
    createdAt: batch.created_at,
    updated_at: batch.updated_at,
    updatedAt: batch.updated_at,
    evidence_completeness_score: score.score,
    evidenceCompletenessScore: score.score,
    disclaimer: EVIDENCE_DISCLAIMER,
    evidenceDisclaimer: EVIDENCE_DISCLAIMER,
    evidence_summary: publicEvidenceSummary,
    evidenceSummary: publicEvidenceSummary,
    milestones: publicEvidenceSummary,
    weight_discrepancy_status: discrepancy.status,
    weightDiscrepancyStatus: discrepancy.status,
    weight_discrepancy_flagged: discrepancy.flagged,
    weightDiscrepancyFlagged: discrepancy.flagged,
    timeline: publicTimeline,
    events: publicTimeline,
    trace_url: traceUrl,
    traceUrl
  };
}

function formatPublicEventLabel(eventType) {
  switch (eventType) {
    case 'BATCH_INITIALIZED': return 'Recovery Batch Created';
    case 'BUYER_MATCHED': return 'Recycling Partner Assigned';
    case 'EVIDENCE_SUBMITTED': return 'Supporting Evidence Uploaded';
    case 'COLLECTION_WEIGHT_RECORDED': return 'Collection Scale Weight Logged';
    case 'COLLECTION_CONFIRMED': return 'Batch Collection Confirmed';
    case 'RECEIVING_WEIGHT_RECORDED': return 'Receiving Facility Scale Weight Logged';
    case 'RECOVERY_CONFIRMED': return 'Physical Reprocessing Confirmed';
    case 'WEIGHT_DISCREPANCY_FLAGGED': return 'Weight Variance Flagged for Audit';
    case 'DISCREPANCY_REVIEWED': return 'Weight Audit Review Completed';
    case 'EVIDENCE_REVIEWED': return 'Evidence Quality Reviewed';
    default: return eventType.replace(/_/g, ' ');
  }
}

/**
 * Generates QR code as a base64 Data URL for a public traceability URL.
 */
async function generateBatchQrDataUrl(batchCodeOrUrl, origin = '') {
  const url = String(batchCodeOrUrl).startsWith('http')
    ? batchCodeOrUrl
    : `${origin}/trace/${encodeURIComponent(batchCodeOrUrl)}`;

  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    color: {
      dark: '#0f5132', // Eco dark forest green
      light: '#ffffff'
    }
  });
}

/**
 * Optional AI Evidence Review using Gemini Vision (if configured).
 * Returns label: "AI-assisted review — not independently verified"
 */
async function analyzeEvidenceWithAi(fileBuffer, mimeType, category) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return {
      used: false,
      label: 'AI Review Offline',
      explanation: 'Gemini API key is not configured. Manual operator review required.'
    };
  }

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Analyze this image submitted as recycling evidence for category "${category}" in a PET plastic beverage bottle recovery system.
Briefly describe what is visible in 1-2 sentences. Verify if it shows clear PET plastic bottles, a weight scale, or recycling processing.
Format as JSON: { "pet_bottles_detected": boolean, "description": string, "recommendation": "PASS" | "FLAG_FOR_REVIEW" }`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: fileBuffer.toString('base64')
              }
            }
          ]
        }
      ]
    });

    const text = response.text || '';
    return {
      used: true,
      label: 'AI-assisted review — not independently verified',
      explanation: text.slice(0, 300)
    };
  } catch (err) {
    return {
      used: false,
      label: 'AI Review Offline',
      explanation: 'AI service unavailable: ' + (err.message || 'Error communicating with vision model.')
    };
  }
}

module.exports = {
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
};
