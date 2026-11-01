# Implementation Blueprint — EcoCycle AI

> This is an architecture and build specification, not application source code. Actual submission code must be created during the authorised hackathon period.

## 1. Proposed stack

Use the simplest stack the team can actually maintain:

- **Frontend:** HTML, CSS, and vanilla JavaScript.
- **Backend:** Node.js with Express if a team member can maintain it; otherwise choose the simplest permitted alternative that safely supports the AI call and matching.
- **Data:** in-memory records or a small local JSON dataset for the demo. A database is optional, not a P0 requirement.
- **AI:** one vision-capable API for material estimation, only if its access, terms, latency, and key management are workable.
- **Hosting:** local laptop demo is acceptable if that is the most reliable option; deploy only if time and internet allow.

Do not add React, a database service, authentication, or cloud deployment merely for appearance. Add a technology only when it solves a concrete requirement.

## 2. Logical architecture

1. **Browser UI** collects the photo and user-supplied details.
2. **Application service** validates the submission and handles the analysis request.
3. **AI analysis adapter** returns an estimated material, visible condition, explanation, and uncertainty. It does not decide which buyer wins.
4. **User confirmation step** allows the user to correct or confirm the result.
5. **Matching service** scores eligible buyers using deterministic criteria.
6. **Listing/status service** records whether the item is submitted, matched, collected, or verified recovered.
7. **Dashboard** aggregates only clearly defined records and statuses.

Keep the AI adapter replaceable so a manual/demo fallback can be used without changing the match logic.

## 3. Pages and components

### A. Home page
- Brand: EcoCycle AI.
- Tagline: Turn Waste Into Value.
- Primary call to action: Submit recyclable waste / Find a recycler.
- Three-step explanation: Upload → Analyse → Match.
- Brief benefit statement focused on suitable material destinations.
- Avoid fake live statistics. Use zero-state or clearly labelled demo numbers.

### B. Waste submission
Fields:
- Image upload (required for image analysis; show preview if possible).
- Material category (initial supported value: PET plastic bottles).
- Quantity and unit (kg for MVP; validate positive numeric input).
- Location (keep only as precise as needed for demo; do not request sensitive personal information).
- Condition/quality (simple selectable options such as clean, mixed, or unknown).
- Optional short description.

### C. Analysis review
Display:
- Estimated material.
- Visible condition estimate, if supported.
- Short explanation of visible evidence.
- Confidence/uncertainty as returned by the chosen service, if available.
- A clear correction/confirmation control.

Never present model confidence as a guaranteed probability unless the provider explicitly defines it that way. Never infer unseen composition or contamination from an unclear image.

### D. Buyer match results
For each buyer show:
- Clearly labelled buyer name/profile.
- Accepted materials.
- Minimum/maximum quantity, if defined.
- Area or service radius, if defined.
- Quality/condition requirements.
- Total compatibility score and reason breakdown.
- Any failed hard requirement.

### E. Listing tracking
Use a small, unambiguous status set:
- `LISTED` — submitted to the application.
- `MATCHED` — a buyer profile has been selected or matched in the demo.
- `COLLECTED` — user/demo operator records that collection occurred.
- `RECOVERED_VERIFIED` — recovery is backed by actual evidence or verified partner confirmation.

Do not automatically change a listing to collected or recovered just because it was matched.

### F. Dashboard
Show counts or quantities separately for each status. During demo, label all simulated records as sample/demo data. Avoid converting waste tonnage into carbon savings without a validated calculation method.

## 4. Conceptual data model

### Waste listing
- listing ID
- image reference or local upload reference
- material category (user-confirmed)
- AI-estimated material (separate from confirmed value)
- quantity and unit
- location area
- condition / quality
- optional description
- analysis status
- listing status
- selected buyer ID (optional)
- created/updated timestamps
- demo/real data flag

### Buyer profile
- buyer ID
- display name
- demo/real flag
- accepted material categories
- minimum and maximum accepted quantity
- supported location/area
- accepted condition/quality
- demand indicator or capacity, if known
- profile notes / data source

### Match result
- listing ID
- buyer ID
- eligibility result
- component scores
- total score
- explanation
- calculation version

## 5. Matching policy

Only compare profiles with enough data. First apply hard eligibility checks (for example: material accepted and quantity within the buyer's allowed range). A buyer that fails a hard requirement should not be ranked as a fully compatible match.

For eligible profiles, an initial transparent weighted score may be:

| Criterion | Weight |
|---|---:|
| Material compatibility | 35% |
| Quantity compatibility | 20% |
| Location fit | 20% |
| Demand / capacity fit | 15% |
| Quality compatibility | 10% |
| **Total** | **100%** |

The team must define how each component score is calculated before implementation. Use a consistent 0–100 scale. Do not let an LLM invent the component or final score. If a field is missing, do not silently award a perfect score; either mark it unknown and adjust transparently or exclude the buyer from ranking. Explain the selected handling in the UI.

Example explanation style (not source code): “This profile ranks highly because it accepts PET, supports the submitted quantity range, serves the selected area, and accepts the stated condition.” Do not claim a real buyer offer unless confirmed.

## 6. API boundaries (conceptual)

If using a backend, keep the interface small:

- Submit a waste listing and receive a listing identifier.
- Request image/material analysis for a listing.
- Confirm or correct material details.
- Request eligible/ranked buyer matches.
- Update listing status.
- Retrieve dashboard summary.

Exact route names and payload shape should be agreed by the team at the event before parallel implementation. Do not create an oversized API for a 24-hour MVP.

## 7. Security and privacy

- Do not ask for phone number, exact home address, or identity documents for the MVP.
- Keep API keys out of client-side code and Git.
- Validate file type and reasonable file size.
- Do not expose uploaded images publicly unless needed and consented to.
- Use fictitious data for the judging demo unless real buyer participation is verified.
- Do not collect personal data just to make the demo look realistic.

## 8. Reliability fallbacks

| Failure | Fallback |
|---|---|
| Vision API cannot be reached | Manual material selection with “AI unavailable/demo mode” label. |
| Image too unclear | Ask user to retake image or select/correct material manually. |
| No compatible buyer | Explain why no profile qualifies; allow the user to edit details. |
| Backend unavailable | Use a local demo path only if it is clearly labelled and tested. |
| Dashboard has no verified recoveries | Show zero verified recovery, not an estimated success figure. |
