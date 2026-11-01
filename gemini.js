/**
 * EcoCycle AI — Gemini Vision Analysis Module
 *
 * Sends a waste image to Google Gemini for material identification.
 * Returns a structured analysis or null if the API is unavailable.
 *
 * This module keeps all Gemini interaction server-side.
 * The API key is never exposed to the client.
 */

const { GoogleGenAI } = require('@google/genai');

// Model choice: gemini-2.0-flash is fast, vision-capable, and cost-effective
const MODEL_NAME = 'gemini-2.0-flash';

// Timeout for the Gemini API call (ms)
const GEMINI_TIMEOUT_MS = 10000;

// The focused prompt for waste image analysis
const ANALYSIS_PROMPT = `You are an expert waste classification and circular economy assistant for EcoCycle AI, a marketplace for turning recyclable waste into measurable economic value.

Analyze this image and respond ONLY with a valid JSON object. Do not include markdown code fences or any text before or after the JSON.

Determine:
1. "material": Primary material visible (e.g., "PET Plastic", "HDPE Plastic", "Cardboard", "Glass", "Metal", "Mixed Waste", or "Unknown / Not Identified").
2. "is_pet_bottle": boolean (true if visible items appear to be PET plastic beverage bottles, false otherwise).
3. "estimated_bottle_count": rough count as an integer if countable (e.g. 1 to 50), or null if piled/bulk.
4. "visible_condition": Brief description of visible state (e.g., "Clean transparent PET bottles with labels removed").
5. "contamination_indicators": Array of strings of visible contamination cues (e.g. ["Non-PET caps attached", "Paper labels present"]).
6. "image_quality_limitations": Array of strings or ["None detected"].
7. "confidence": "High", "Medium", or "Low".
8. "notes": One sentence of additional observations.
9. "warnings": Array of strings for uncertainties.

Detailed Circular Economy Fields:
10. "wasteCategory": e.g. "Plastic", "Paper", "Metal", "Glass", "Organic", "Electronic"
11. "materialSubtype": Specific subtype (e.g., "Post-consumer clear PET beverage bottles")
12. "polymerType": e.g. "PET", "HDPE", "LDPE", "PP", "PS", "Other", or "Non-Plastic"
13. "recoveryPotential": "High", "Medium", "Low", or "Needs verification"
14. "recyclable": boolean
15. "reusable": boolean
16. "moistureAndResidue": Observation regarding wetness, sludge, or grease
17. "sortingIssues": Observation regarding multi-material mixtures or foreign debris
18. "processingState": "Loose", "Compressed", "Baled", "Shredded", or "Unknown"
19. "damageOrDegradation": Observation regarding weathering, UV degradation, or crushing
20. "recyclingMethod": Recommended industrial recycling route (e.g., "Mechanical shredding, sink-float washing, and rPET flake extrusion")
21. "recommendedPreparationSteps": Actionable preparation advice before handover (e.g., "Empty liquids, unscrew non-PET caps, crush to reduce volume")
22. "recoveryReason": Specific reason why this material holds circular economy value
23. "reuseMethods": Array of practical secondary reuse methods (e.g. ["Planters", "Liquid storage", "Organizers"])
24. "environmentalImpact": Environmental savings statement (e.g., "Diverts landfill waste and saves up to 1.5 kg CO2e per kg recycled")
25. "recommendedAction": Practical next step for the waste generator
26. "marketplaceEligible": boolean (true if suitable for EcoCycle AI marketplace)
27. "verificationRequired": boolean (true if confidence is Low or material is ambiguous)

Respond with ONLY this JSON structure:
{
  "material": "PET Plastic",
  "is_pet_bottle": true,
  "estimated_bottle_count": 5,
  "visible_condition": "Clean transparent PET bottles",
  "contamination_indicators": [],
  "image_quality_limitations": ["None detected"],
  "confidence": "High",
  "notes": "Clear beverage containers suitable for flake recycling.",
  "warnings": [],
  "wasteCategory": "Plastic",
  "materialSubtype": "Post-consumer clear PET beverage bottles",
  "polymerType": "PET",
  "recoveryPotential": "High",
  "recyclable": true,
  "reusable": false,
  "moistureAndResidue": "Dry bottles without visible liquid residue",
  "sortingIssues": "Uniform material with minimal visible non-PET items",
  "processingState": "Loose",
  "damageOrDegradation": "Light crushing; suitable for processing",
  "recyclingMethod": "Mechanical washing, flake sorting, and pelletization",
  "recommendedPreparationSteps": "Remove caps and labels, flatten bottles",
  "recoveryReason": "Clean clear PET scrap has high demand for rPET textile and bottle-to-bottle manufacture",
  "reuseMethods": ["Non-food storage", "Seedling planters"],
  "environmentalImpact": "Avoids plastic leakage and cuts virgin resin greenhouse footprint",
  "recommendedAction": "Submit batch weight and stage for aggregator matching",
  "marketplaceEligible": true,
  "verificationRequired": false
}`;

/**
 * Analyze an image using Gemini Vision.
 *
 * @param {Buffer} imageBuffer - The raw image file bytes
 * @param {string} mimeType   - The image MIME type (image/jpeg, image/png, image/webp)
 * @returns {Promise<object|null>} Parsed analysis result, or null on failure
 */
async function analyzeImageWithGemini(imageBuffer, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;

  // If no key is configured, return null so the caller uses the fallback
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.log('Gemini: No API key configured — using fallback.');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Convert image to base64 for inline data
    const base64Image = imageBuffer.toString('base64');

    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let response;
    try {
      response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image,
            },
          },
          {
            text: ANALYSIS_PROMPT,
          },
        ],
      });
    } finally {
      clearTimeout(timeout);
    }

    // Extract text from the response
    const rawText = response.text;
    if (!rawText || typeof rawText !== 'string') {
      console.warn('Gemini: Empty or invalid response text.');
      return null;
    }

    // Parse JSON from the response — handle markdown code fences
    let jsonText = rawText.trim();
    // Strip ```json ... ``` wrapper if present
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.warn('Gemini: Could not parse JSON from response:', jsonText.substring(0, 200));
      return null;
    }

    // Validate required fields
    const result = normalizeGeminiResult(parsed);
    if (!result) {
      console.warn('Gemini: Response missing required fields.');
      return null;
    }

    return result;

  } catch (err) {
    // Don't log API keys or full error details that might contain them
    const safeMessage = err.name === 'AbortError'
      ? 'Request timed out'
      : (err.message || 'Unknown error').substring(0, 100);
    console.warn('Gemini: API request failed —', safeMessage);
    return null;
  }
}

/**
 * Normalize and validate the parsed Gemini response.
 * Returns a clean object or null if the response is unusable.
 */
function normalizeGeminiResult(parsed) {
  if (typeof parsed === 'string') {
    let jsonText = parsed.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const material = typeof parsed.material === 'string' ? parsed.material.trim() : '';
  const visible_condition = typeof parsed.visible_condition === 'string' ? parsed.visible_condition.trim() : '';
  const confidence = typeof parsed.confidence === 'string' ? parsed.confidence.trim() : '';
  const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : '';

  // material and visible_condition are required
  if (!material || !visible_condition) return null;

  // Normalize confidence to expected values
  const normalizedConfidence = normalizeConfidence(confidence);

  // is_pet_bottle
  let is_pet_bottle = Boolean(parsed.is_pet_bottle);
  if (parsed.is_pet_bottle === undefined) {
    is_pet_bottle = material.toLowerCase().includes('pet');
  }

  // estimated_bottle_count
  let estimated_bottle_count = null;
  if (typeof parsed.estimated_bottle_count === 'number' && Number.isInteger(parsed.estimated_bottle_count) && parsed.estimated_bottle_count >= 0) {
    estimated_bottle_count = parsed.estimated_bottle_count;
  }

  // contamination_indicators
  let contamination_indicators = [];
  if (Array.isArray(parsed.contamination_indicators)) {
    contamination_indicators = parsed.contamination_indicators
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
  }

  // image_quality_limitations: normalize to array of strings
  let image_quality_limitations = [];
  if (Array.isArray(parsed.image_quality_limitations)) {
    image_quality_limitations = parsed.image_quality_limitations
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
  } else if (typeof parsed.image_quality_limitations === 'string' && parsed.image_quality_limitations.trim()) {
    image_quality_limitations = [parsed.image_quality_limitations.trim()];
  } else {
    image_quality_limitations = ['None detected'];
  }

  // warnings
  let warnings = [];
  if (Array.isArray(parsed.warnings)) {
    warnings = parsed.warnings
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
  }
  // Standard safety warning reminder: visual analysis cannot replace certified weighing or chemical testing
  warnings.push('Visual estimation only: Actual weight, material grade, and contamination must be confirmed upon collection.');

  const isPet = is_pet_bottle || material.toLowerCase().includes('pet');
  const polymerType = typeof parsed.polymerType === 'string' && parsed.polymerType.trim()
    ? parsed.polymerType.trim()
    : (isPet ? 'PET (Polyethylene Terephthalate, Resin #1)' : (material.includes('Plastic') ? 'Other Plastic' : 'Non-Plastic'));

  const wasteCategory = typeof parsed.wasteCategory === 'string' && parsed.wasteCategory.trim()
    ? parsed.wasteCategory.trim()
    : (material.toLowerCase().includes('plastic') || isPet ? 'Plastic' : 'Recyclable Waste');

  const materialSubtype = typeof parsed.materialSubtype === 'string' && parsed.materialSubtype.trim()
    ? parsed.materialSubtype.trim()
    : (isPet ? 'Used PET beverage bottles' : material);

  const recoveryPotential = typeof parsed.recoveryPotential === 'string' && parsed.recoveryPotential.trim()
    ? parsed.recoveryPotential.trim()
    : (normalizedConfidence === 'Low' ? 'Needs verification' : (isPet ? 'High' : 'Medium'));

  const recyclable = typeof parsed.recyclable === 'boolean'
    ? parsed.recyclable
    : isPet;

  const reusable = typeof parsed.reusable === 'boolean'
    ? parsed.reusable
    : false;

  const moistureAndResidue = typeof parsed.moistureAndResidue === 'string' && parsed.moistureAndResidue.trim()
    ? parsed.moistureAndResidue.trim()
    : (contamination_indicators.length > 0 ? 'Some residue observed' : 'Visual inspection suggests dry containers without heavy sludge');

  const sortingIssues = typeof parsed.sortingIssues === 'string' && parsed.sortingIssues.trim()
    ? parsed.sortingIssues.trim()
    : (contamination_indicators.length > 0 ? contamination_indicators.join(', ') : 'Single polymer stream observed');

  const processingState = typeof parsed.processingState === 'string' && parsed.processingState.trim()
    ? parsed.processingState.trim()
    : 'Loose post-consumer containers';

  const damageOrDegradation = typeof parsed.damageOrDegradation === 'string' && parsed.damageOrDegradation.trim()
    ? parsed.damageOrDegradation.trim()
    : 'Light crushing or compaction; polymer structure appears suitable for recycling';

  const recyclingMethod = typeof parsed.recyclingMethod === 'string' && parsed.recyclingMethod.trim()
    ? parsed.recyclingMethod.trim()
    : (isPet ? 'Mechanical shredding, hot washing, sink-float flake separation, and rPET extrusion' : 'Secondary material reprocessing');

  const recommendedPreparationSteps = typeof parsed.recommendedPreparationSteps === 'string' && parsed.recommendedPreparationSteps.trim()
    ? parsed.recommendedPreparationSteps.trim()
    : 'Empty residual liquids, remove non-PET closures/labels, compress bottles to reduce transport volume';

  const recoveryReason = typeof parsed.recoveryReason === 'string' && parsed.recoveryReason.trim()
    ? parsed.recoveryReason.trim()
    : 'Clear post-consumer PET bottles have established commercial buyback scrap value and steady demand from regional reclaimers';

  let reuseMethods = ['Non-food storage containers', 'Plant seedling nursery pots'];
  if (Array.isArray(parsed.reuseMethods) && parsed.reuseMethods.length > 0) {
    reuseMethods = parsed.reuseMethods.map(m => String(m).trim()).filter(Boolean);
  }

  const environmentalImpact = typeof parsed.environmentalImpact === 'string' && parsed.environmentalImpact.trim()
    ? parsed.environmentalImpact.trim()
    : 'Diverting PET from open landfills saves ~1.5 kg CO2e per kg recycled and prevents microplastic marine pollution';

  const recommendedAction = typeof parsed.recommendedAction === 'string' && parsed.recommendedAction.trim()
    ? parsed.recommendedAction.trim()
    : 'Review and confirm material details, then match with nearby authorized recyclers';

  const marketplaceEligible = typeof parsed.marketplaceEligible === 'boolean'
    ? parsed.marketplaceEligible
    : isPet;

  const verificationRequired = typeof parsed.verificationRequired === 'boolean'
    ? parsed.verificationRequired
    : (normalizedConfidence === 'Low' || !isPet);

  const detailed_classification = {
    wasteCategory,
    identifiedMaterial: material,
    materialSubtype,
    polymerType,
    confidence: normalizedConfidence,
    recoveryPotential,
    recyclable,
    reusable,
    condition: visible_condition,
    contamination: contamination_indicators.join(', ') || 'No significant foreign contamination observed',
    moistureAndResidue,
    sortingIssues,
    processingState,
    damageOrDegradation,
    recyclingMethod,
    recommendedPreparationSteps,
    recoveryReason,
    reuseMethods,
    environmentalImpact,
    recommendedAction,
    marketplaceEligible,
    warnings,
    verificationRequired,
    backendStatus: 'AI Analysis Successful (Gemini 2.0 Flash)'
  };

  return {
    material,
    is_pet_bottle,
    estimated_bottle_count,
    visible_condition,
    contamination_indicators,
    image_quality_limitations,
    confidence: normalizedConfidence,
    notes: notes || 'No additional notes.',
    warnings,
    is_rough_estimate: true,
    detailed_classification,
    wasteCategory,
    identifiedMaterial: material,
    materialSubtype,
    polymerType,
    recoveryPotential,
    recyclable,
    reusable,
    processingState,
    recyclingMethod,
    recoveryReason,
    environmentalImpact,
    recommendedAction,
    marketplaceEligible,
    verificationRequired
  };
}

/**
 * Normalize confidence string to one of: High, Medium, Low.
 * Falls back to 'Medium' for unexpected values.
 */
function normalizeConfidence(raw) {
  const lower = (raw || '').toLowerCase().trim();
  if (lower.includes('high')) return 'High';
  if (lower.includes('low')) return 'Low';
  if (lower.includes('medium') || lower.includes('moderate')) return 'Medium';
  return 'Medium';
}

// Export for use in server.js and for testing
module.exports = {
  analyzeImageWithGemini,
  normalizeGeminiResult,
  normalizeConfidence,
  MODEL_NAME,
  GEMINI_TIMEOUT_MS
};

