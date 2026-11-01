# EcoCycle AI — Turn Waste Into Value

**Tagline:** Turn Waste Into Value  
**Event:** GRAVITON 2026 Hackathon  
**Target Material:** Post-Consumer PET Plastic Beverage Bottles  

---

## Project Overview

**EcoCycle AI** is an AI-assisted circular waste recovery marketplace that bridges the gap between waste generators, aggregators, and certified polymer recyclers. By combining multimodal vision analysis with deterministic algorithmic matching, location-based PET price intelligence, bilateral trade negotiations, Razorpay test payments, and cryptographically verified physical recovery tracking (EcoProof Loop), EcoCycle AI transforms informal, opaque waste streams into transparent, high-value circular transactions.

### Key Features
1. **AI Waste Inspection**: Multimodal Gemini Vision classification estimating PET bottle material, bottle counts, cleanliness, and baling condition (with zero-dependency offline fallback).
2. **Deterministic Recycler Matching**: Transparent, multi-factor compatibility ranking based on accepted volume, location coverage, and demand tiers (Scoring $\ne$ Price).
3. **Location-Based PET Price Intelligence**: 6-tier market data hierarchy spanning 12 Indian recycling hubs, Indian PIN code resolution, and material quality adjustments (+15% baled premium, -20% unstripped labels deduction, -40% contamination).
4. **Bilateral Negotiations & Counteroffers**: Real-time counteroffer workflows with real-time trade chat integration.
5. **Digital Waste Transaction Receipts**: Immutable transaction receipts with canonical SHA-256 digests and public verification.
6. **Official Razorpay Standard Checkout**: Test mode payment workflows with server-side HMAC-SHA256 signature verification and replay prevention.
7. **Multi-Tenant Authentication & RBAC**: Persistent SQLite session storage, bcrypt password hashing (15+ character passphrase policy), and strict multi-tenant authorization for private listings.
8. **EcoProof Loop Traceability**: Milestone evidence collection, scale slip weight discrepancy detection (>10%), SHA-256 chained audit logs, and public QR code verification.

### Technology Stack
- **Backend**: Node.js, Express 4, Node built-in `node:sqlite` (`DatabaseSync`), `node:crypto`
- **Frontend**: Vanilla HTML5, CSS3 (Modern Climate-Tech Design System), JavaScript (ES2022)
- **AI & Computer Vision**: Google Gemini 2.5 Flash Multimodal Vision (`@google/genai`) with offline fallback
- **Location & Geospatial**: Google Maps Platform (Maps JavaScript API & Places Autocomplete)
- **Payment Processing**: Official Razorpay Node.js SDK (`razorpay`) in Test Mode
- **Cryptography**: Native SHA-256 HMAC & hash chaining (`node:crypto`)

---

## Getting Started

### 1. Prerequisites
- Node.js (v20+ or v22+ recommended; uses native `node:sqlite`)
- npm (v9+)

### 2. Installation
```bash
git clone <repository-url>
cd eco-ai
npm install
```

### 3. Environment Variables Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Configure your keys in `.env` (all external services have graceful offline fallbacks):
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
GOOGLE_MAPS_BROWSER_KEY=your_google_maps_browser_key_here
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_secret_here
SESSION_SECRET=your_random_32_character_session_secret_here
```

### 4. Running the Application
```bash
npm start
# Server starts at http://localhost:3000
```

### 5. Running Automated Tests
Run all test suites without any external credentials or network dependencies:
```bash
npm test
```
Or run individual test suites:
```bash
node test-feature-marketplace-flow.js    # E2E circular trade lifecycle (40 tests)
node test-feature-price-intelligence.js  # Location-based PET price intelligence (47 tests)
node test-feature-razorpay.js            # Razorpay standard checkout in test mode (59 tests)
node test-phase9.js                      # Core price intelligence arithmetic (89 tests)
node test-phase10.js                     # Authentication & multi-tenant auth (91 tests)
node test-phase11.js                     # EcoProof Loop chained audit trail (73 tests)
```

---

## Google Maps Platform Integration (Phase 6)

EcoCycle AI features an interactive Google Maps location picker that replaces static dropdowns while maintaining deterministic, explainable buyer matching.

### 1. Google Cloud Setup & API Keys

To activate the interactive Google Maps picker in your development or production environment:

1. **Create or select a Google Cloud Project**:
   * Visit the [Google Cloud Console](https://console.cloud.google.com/).
   * Create a new project (e.g. `ecocycle-ai-demo`).

2. **Enable Required APIs**:
   * Navigate to **APIs & Services > Library**.
   * Search for and enable **Maps JavaScript API**.
   * Search for and enable **Places API** (for address search and autocomplete).

3. **Billing**:
   * Google Maps Platform requires an active billing account linked to your project. Google provides a recurring \$200 monthly free credit for Maps, Routes, and Places.

4. **Create and Restrict the Browser API Key**:
   * Navigate to **APIs & Services > Credentials**.
   * Click **Create Credentials > API Key**.
   * Rename the key to `EcoCycle-Browser-Maps-Key`.
   * Under **Application restrictions**, select **Websites** (HTTP referrers) and restrict to your domains:
     * Development: `http://localhost:3000/*` and `http://127.0.0.1:3000/*`
     * Production: `https://your-domain.vercel.app/*` (or your deployment URL).
   * Under **API restrictions**, select **Restrict key** and choose only:
     * *Maps JavaScript API*
     * *Places API*
   * Save the key.

5. **Configure Environment Variables**:
   * Open `.env` (or copy from `.env.example`).
   * Add your restricted browser key:
     ```env
     GOOGLE_MAPS_BROWSER_KEY=your_actual_restricted_browser_key_here
     ```

6. **Start or Restart the Application**:
   ```bash
   node server.js
   ```

### 2. Testing Without an API Key (Graceful Fallback Mode)

* If `GOOGLE_MAPS_BROWSER_KEY` is omitted, blank, or invalid, EcoCycle AI automatically activates **Graceful Fallback Mode**:
  * An informative banner explains that interactive mapping is offline.
  * The manual locality / zone selector is presented prominently.
  * Image upload, Gemini AI material analysis, listing creation, and deterministic matching remain 100% operational.
  * Automated backend test suites (`test-phase2.js` through `test-phase6.js`) run completely offline with zero external key requirements.

### 3. Location Capture & Matching Limitations

* **GPS Location Persistence**: When the map marker is confirmed, the listing saves `latitude`, `longitude`, `formatted_address`, `place_id`, and `locality`.
* **Demo Buyer Data Boundary**: Fictional demo recyclers in `data/buyers.json` use service coverage zones (`North Sector`, `South Hub`, `Central City`, `Industrial East`).
* **No Fabricated Distances**: Because demo buyers do not have real GPS coordinates, EcoCycle AI explicitly discloses `geographic_distance_included: false` and evaluates verified zone eligibility. We never fabricate fake buyer pins, driving times, or transport costs.

---

## Razorpay Payment Integration & Material Recovery Tracking (Phase 7)

EcoCycle AI includes a secure Razorpay test-mode payment workflow and a separate physical recovery lifecycle tracker.

### 1. Razorpay Test Mode Setup

1. **Obtain Test Keys**:
   * Log into the [Razorpay Dashboard](https://dashboard.razorpay.com/).
   * Switch into **Test Mode**.
   * Navigate to **Settings > API Keys** and generate a Key ID (`rzp_test_...`) and Key Secret.
2. **Add to `.env`**:
   ```env
   RAZORPAY_KEY_ID=rzp_test_your_key_id
   RAZORPAY_KEY_SECRET=your_test_secret_here
   ```
3. **Security Principles**:
   * Only `RAZORPAY_KEY_ID` is ever exposed via `GET /api/config/razorpay`.
   * `RAZORPAY_KEY_SECRET` remains strictly confidential on the backend.
   * `POST /api/payments/verify` performs HMAC-SHA256 signature verification using constant-time comparison (`crypto.timingSafeEqual`) to defeat timing attacks.

### 2. Separation of Financial and Physical Recovery Workflows

* **Demo Facilitation Fee**: The ₹50.00 test payment represents a simulated logistics reservation fee in Razorpay Test Mode.
* **Score is Not Price**: Buyer matching compatibility scores are heuristic algorithmic ranking values, never financial quotes or pricing guarantees.
* **Waste Recovery Lifecycle**: Waste is never counted as recovered simply because a listing is created or a test fee is recorded. Physical recovery progresses through 4 strictly enforced forward stages:
  1. `LISTED` — Material registered and categorized.
  2. `MATCHED` — Recycling partner selected and pickup reserved.
  3. `COLLECTION_CONFIRMED` — Batch physically collected on-site by logistics carrier.
  4. `RECOVERY_CONFIRMED` — PET bottles weighed, de-labelled, and accepted at reprocessing facility.

---

## Phase 8: Final Quality Assurance & Security Hardening

EcoCycle AI incorporates rigorous architectural protections:

1. **State Machine Integrity**: Forward linear transitions (`LISTED` -> `MATCHED` -> `COLLECTION_CONFIRMED` -> `RECOVERY_CONFIRMED`) are enforced by the server. Out-of-order skips, status regressions, and transitions out of terminal state are rejected with HTTP 400.
2. **Honest Attribution**: Physical recovery audit logs default to `Demo Operator (User-Entered)` — never falsely claiming independent third-party laboratory certification.
3. **Cross-Transaction Payment Replay Prevention**: Payment IDs verified on one order cannot be reused to confirm unrelated transactions.
4. **Security Headers**: All responses emit `X-Content-Type-Options: nosniff` and `X-Frame-Options: SAMEORIGIN`.
5. **Payload Limiting**: Body parsers enforce a 1 MB size limit to prevent Denial-of-Service attacks.
6. **Graceful Demo Mode**: If any external provider (Gemini Vision, Google Maps, or Razorpay) lacks API credentials, the platform falls back to offline operation without crashing.

---

## Phase 9: Location-Based PET Scrap Price Intelligence & Recovery Value Estimation

EcoCycle AI features an explainable, location-aware price intelligence engine for PET plastic scrap bottles (`pet-price-service.js`). It answers the fundamental user question: *"Based on available PET scrap price data for my location, approximately how much could my listed material be worth?"*

### 1. Architectural Guardrails & Separation of Concerns

* **Strict Informational Separation**: Price estimation is strictly informational. It does **not** alter buyer compatibility scores, scoring weights, or eligibility filters in `matching.js`.
* **Zero Disruption to Payments & Recovery**: Price intelligence does not create Razorpay orders, change transaction amounts, or advance the physical material recovery lifecycle.
* **Strict Material Form Boundaries**: Strictly scoped to PET plastic beverage bottles (`used_beverage_bottles`). It strictly excludes incompatible industrial forms such as washed flakes (`washed_flakes`) or recycled pellets (`rpet_pellets`).

### 2. Geographic Selection Hierarchy

The engine resolves benchmark pricing via a deterministic multi-tiered hierarchy:
1. **Level 1 (Local City Benchmark)**: Exact locality/city match (e.g. *Central City*, *North Sector*, *Industrial East*).
2. **Level 2 (State-Level Indicative Estimate)**: Regional benchmark for the user's state or territory (e.g. *Punjab Regional Benchmark*).
3. **Level 3 (National Indicative Benchmark)**: Broad country-level baseline (e.g. *India National Benchmark*).
4. **Level 4 (Graceful Fallback)**: If no geographic match exists, returns HTTP 200 with status `PRICE_DATA_UNAVAILABLE` and an actionable advisory note.

### 3. Freshness Assessment Policy

Every price record is evaluated against its observation timestamp (`observed_at`) using transparent freshness buckets:
* **`FRESH`** ($\le 7$ days): Recent market observation.
* **`RECENT`** ($8 - 30$ days): Moderate age indicative estimate.
* **`STALE`** ($> 30$ days): Historical benchmark presented with a staleness warning badge.
* **`UNKNOWN`**: Future or unparseable timestamps.

### 4. Data Transparency & Honest Labeling

* **No Fictitious Live Tickers**: EcoCycle AI never invents random numbers or pretends static demo data is a "real-time live ticker".
* **Source Attribution**: All benchmark estimates disclose their origin (`MANUALLY_IMPORTED` or `DEMO`), source organization, and observation date.
* **Decimal-Safe Arithmetic**: Range calculations ($\text{Quantity} \times \text{Min/Max Price}$) are rounded to 2 decimal places to prevent floating-point inaccuracies.

---

## Phase 10: Authentication, User Sessions & Multi-Tenant Authorization

EcoCycle AI includes a complete authentication, session management, and multi-tenant authorization system built with Node.js built-in `node:sqlite`, `bcryptjs`, and Express sessions.

### 1. Architectural Components

* **`db.js`**: Built on Node's native `node:sqlite` (`DatabaseSync`), requiring zero native C++ compilation toolchains. Automatically initializes persistent `users` and `sessions` tables with parameterized SQL statements.
* **`auth-service.js`**:
  * **Password Hashing**: Uses `bcryptjs` with a work factor of 10.
  * **Passphrase Security Policy**: Enforces a strict minimum of **15 characters** aligned with modern OWASP passphrase guidance, with a 128-character upper ceiling to mitigate hash DoS attacks. Arbitrary character complexity rules are avoided to encourage memorable, high-entropy passphrases.
  * **Email Normalization**: Normalizes emails to lowercase and trimmed strings, protected by a database-level `UNIQUE` constraint.
  * **Anti-Enumeration**: Authentication failures return a generic `INVALID_CREDENTIALS` error.
* **`auth-middleware.js`**:
  * **Persistent Session Store**: `SqliteSessionStore` persists sessions in SQLite across server restarts.
  * **Cookie Security**: `HttpOnly`, `SameSite=Lax`, and `Secure` (in production).
  * **Session Fixation Defense**: Regenerates session IDs upon login via `req.session.regenerate()`.
  * **Sliding-Window Rate Limiting**: Enforces rate limits on `/api/auth/login` (10 attempts / 15 min) and `/api/auth/register` (15 attempts / 15 min), returning HTTP 429 when exceeded.
  * **CSRF & Origin Defense**: Validates request origin against host for state-changing requests.

### 2. Route Classification & Access Policy

| Route | Method | Access Level | Description |
|---|---|---|---|
| `/api/health` | `GET` | **Public** | Service health status and subsystem flags |
| `/api/buyers` | `GET` | **Public** | Demo recycler profiles |
| `/api/config/maps` | `GET` | **Public** | Restricted browser Maps API key |
| `/api/config/razorpay` | `GET` | **Public** | Public Razorpay key ID |
| `/api/prices/records` | `GET` | **Public** | PET scrap benchmark records |
| `/api/analyze` | `POST` | **Public Demo** | Public AI / fallback waste inspection |
| `/api/auth/register` | `POST` | **Public (Rate-limited)** | Creates user account & starts session |
| `/api/auth/login` | `POST` | **Public (Rate-limited)** | Authenticates user & regenerates session |
| `/api/auth/me` | `GET` | **Public / Session** | Returns current user profile (or 401) |
| `/api/auth/logout` | `POST` | **Authenticated** | Destroys session and clears cookie |
| `/api/auth/profile` | `GET` | **Authenticated** | Returns authenticated profile |
| `/api/listings` | `POST` | **Public Demo / Authenticated** | Creates private listing if signed in; guest demo listing if unauthenticated |
| `/api/listings` | `GET` | **Public Demo / Authenticated** | Returns user's private listings if signed in; demo listings if guest |
| `/api/match` | `POST` | **Owner-Only (if listing_id)** | Requires ownership if referencing private listing; public if raw details |
| `/api/prices/estimate` | `POST` | **Owner-Only (if listing_id)** | Requires ownership if referencing private listing; public if raw details |
| `/api/payments/create-order` | `POST` | **Owner-Only** | Only listing owner can initiate payment order |
| `/api/payments/status/:id` | `GET` | **Owner-Only** | Only listing owner can inspect payment details |
| `/api/listings/:id/recovery` | `POST` | **Owner-Only** | Only listing owner can advance recovery lifecycle |
| `/api/reset` | `POST` | **Development Only** | Disabled in production (`NODE_ENV=production` returns 403) |

---

## Running Test Suites

```bash
node test-phase2.js   # 48 passing assertions (Core upload & endpoints)
node test-phase3.js   # 96 passing assertions (Gemini Vision integration & fallbacks)
node test-phase4.js   # 76 passing assertions (Deterministic matching engine & weights)
node test-phase5.js   # 66 passing assertions (E2E integration, security, & reliability)
node test-phase6.js   # 58 passing assertions (Google Maps Platform & location validation)
node test-phase7.js   # 77 passing assertions (Razorpay test payments & honest recovery)
node test-phase8.js   # 78 passing assertions (Final QA, state machine & security hardening)
node test-phase9.js   # 89 passing assertions (Location-based PET price intelligence)
node test-phase10.js  # 91 passing assertions (Authentication, sessions & multi-tenant auth)
node test-phase11.js  # 73 passing assertions (EcoProof Loop traceability, evidence & audit)
```

Total: **752 passing test assertions** (0 failing across all 10 test suites).

---

## EcoProof Loop Traceability (Phase 11)

EcoCycle AI features **EcoProof Loop** — an evidence-backed recovery verification and cryptographic audit system that makes the physical journey of a PET beverage bottle batch transparent, auditable, and tamper-evident.

### Key Capabilities
- **Unique Batch Identifiers**: Automatically generates human-readable batch codes in the format `ECO-PET-2026-XXXX`.
- **Milestone Evidence Records**: Secure authenticated uploads for 5 key recovery milestones (`PICKUP_PHOTO`, `COLLECTION_WEIGHT`, `RECEIVER_CONFIRMATION`, `RECEIVING_WEIGHT`, `PROCESSING_EVIDENCE`) with magic-byte format validation and disk SHA-256 integrity digests.
- **Deterministic Evidence Completeness Score**: 0–100% scoring based strictly on submitted and reviewed evidence (20 pts per milestone) accompanied by mandatory transparency disclaimers.
- **Weight Variance & Discrepancy Detection**: Validates scale inputs, flags variance exceeding 10% between collection and receiving weights, and supports operator discrepancy reviews.
- **Cryptographic SHA-256 Audit Chain**: Every status change, weight measurement, evidence upload, and review creates an immutable audit event referencing the SHA-256 hash of its predecessor, verifiable via `verifyAuditChain()`.
- **Public QR Traceability**: Instant QR code generation and dedicated public route (`/trace/:batchCode`) that safely strips private GPS coordinates, donor contact info, and internal session secrets.

---

## 5-Minute Live Demonstration Guide

1. **Launch**: Run `node server.js` and open `http://localhost:3000`.
2. **User Registration & Login (Phase 10)**:
   - Click **Create Account** in the navbar.
   - Enter full name, email, and a memorable 15+ character passphrase (e.g. `green-bottle-river-clean`).
   - Notice that the user is immediately signed in with a persistent SQLite session. The navbar displays your profile badge.
3. **Upload & AI Analysis**:
   - Drag and drop a photo of clear PET bottles.
   - Click **Analyze My Waste**. The system analyzes the image using Gemini Vision (or safe fallback mode when unconfigured) and estimates material and condition.
4. **Review & Confirm**:
   - Verify the AI estimate. Notice the ownership callout indicating the listing will be saved to your private authenticated account.
   - Confirm quantity (e.g., `25` kg) and condition (`Clean`).
5. **Pin Location**:
   - Search for a neighborhood or drag the interactive Google Maps pin (or use the manual zone selector if Maps is unconfigured).
   - Click **Confirm Pinned Location**.
6. **Create Listing**:
   - Click **Confirm & Create Listing**. The listing is created with your server-verified `user_id`.
7. **Price Intelligence (Phase 9)**:
   - Click **Estimate PET Scrap Value** to view the benchmark unit price and total estimated scrap value range.
8. **Deterministic Matching & Checkout**:
   - Click **Find Matching Buyers** and reserve pickup via Razorpay in test mode.
9. **Physical Recovery Tracking**:
   - Advance the 4-step recovery stepper from `MATCHED` to `COLLECTION_CONFIRMED` and `RECOVERY_CONFIRMED`.
10. **EcoProof Loop Traceability (Phase 11)**:
    - Click **EcoProof Loop Traceability**.
    - View the generated batch code (e.g. `ECO-PET-2026-XXXX`).
    - Upload milestone evidence documents and scale slips (JPEG/PNG/WebP).
    - Log collection and receiving weights and observe real-time variance calculations.
    - Inspect the SHA-256 cryptographically chained audit timeline.
    - Scan the public QR code or open `/trace/:batchCode` in an incognito window to verify zero sensitive data leakage.
11. **Logout**:
    - Click **Log Out**. The session is destroyed server-side and the interface cleanly resets to public demo mode.

---

## Important schedule note

The official GRAVITON pages available at the time this pack was prepared list hacking beginning at **11:00 AM IST on 31 October 2026**. The main event page lists code freeze at **10:00 AM IST on 1 November**, while a separate official schedule page lists **11:00 AM IST**. Confirm the final time in the registered-team WhatsApp group or with the organisers. This pack uses **9:30 AM IST on 1 November** as an internal stop target to provide a buffer before either published freeze time.

## Sources to reconfirm

- GRAVITON event page: https://iste.cgcuniversity.in/graviton-event
- GRAVITON schedule: https://istegraviton.vercel.app/schedule
- Antigravity rules documentation: https://antigravity.google/docs/rules/

Event details can change. The organisers' latest instruction to registered teams takes priority over this planning document.
