# Brain — EcoCycle AI

## 1. One-line idea

EcoCycle AI helps people identify recyclable waste and find a suitable next destination for it by connecting material information with buyer requirements.

## 2. Tagline

**Turn Waste Into Value.**

## 3. Problem

Waste generators may have recyclable material but may not know:
- what material they have;
- whether it is clean or usable enough for a recycler;
- what quantity a buyer accepts;
- which recycler or processor is a suitable fit;
- what happens after a listing is submitted.

A generic classified listing can show waste to many people, but does not necessarily help decide which buyer is suitable.

## 4. Proposed solution

The user submits a waste photo and basic details. An AI-assisted analysis estimates the material category and visible condition. The user can correct the estimate. EcoCycle then compares the confirmed details against buyer requirements and displays ranked, explainable matches.

The application helps answer: **“Given this material, quantity, quality, and location, which available buyer profile is the most suitable next option?”**

## 5. Product differentiator

The core value is **compatibility-based matching**, not simply image recognition or a generic waste marketplace.

A match should be explainable through:
- material compatibility;
- quantity compatibility;
- location suitability;
- buyer demand or acceptance status;
- quality/condition compatibility.

The ranking is deterministic and transparent. AI may help interpret the image, but it must not invent the ranking or fabricate buyer facts.

## 6. Main users

- **Waste generator:** household, shop, institution, or small business with recyclable material.
- **Recycler/buyer:** a recycling business or processor with material, quantity, location, and quality requirements.
- **Demo evaluator:** a judge who needs to understand the flow, the reasoning behind a match, and the limitations.

## 7. MVP user journey

1. User opens the homepage and chooses to submit waste.
2. User uploads a clear image.
3. User enters material details, quantity, location, and condition.
4. The AI-assisted service estimates material and visible condition, with uncertainty where appropriate.
5. User reviews and can correct the estimate.
6. The app compares the submitted waste with available buyer profiles.
7. The app presents a short ranked list and explains why each buyer is or is not a good fit.
8. User chooses a match or saves the listing.
9. Listing status can be updated through a small set of clear states.

## 8. MVP boundary

**Initial material scope: PET plastic bottles only.** This gives the team a narrow material type with which to demonstrate an end-to-end process. Other materials are future scope unless the complete PET flow is stable early.

Required features, in priority order:
1. Home page and clear call to action.
2. Waste submission form with image and required details.
3. AI-assisted material estimate OR a clearly labelled manual/demo fallback if the service is unavailable.
4. User correction/confirmation of the estimate.
5. Buyer matching using deterministic rules.
6. Match explanation.
7. Listing status tracking.
8. Small dashboard that distinguishes listing, matching, collection, and recovery.

## 9. What success looks like

A judge can start at the homepage, submit a PET-bottle waste listing, review the analysis, see suitable buyer matches with understandable reasons, and follow the listing status. The app behaves consistently and the team can explain its logic and limitations.

## 10. Non-goals for this 24-hour build

- Blockchain or token systems.
- IoT devices, smart bins, or sensor hardware.
- Custom-trained machine-learning models.
- Payment processing or escrow.
- Live logistics, route optimisation, or pickup scheduling.
- Live commodity-price predictions.
- Large multi-material marketplace.
- Complex microservices, Kubernetes, or elaborate cloud infrastructure.
- Unverified claims of actual recycling, money saved, or carbon emissions avoided.

## 11. Product principles

- Honest over flashy.
- Working end-to-end flow over a large feature list.
- Explainable matches over unexplained AI scores.
- User correction over blind trust in image analysis.
- Real data where verified; clearly labelled demo data where simulated.
- Accessible language and a simple mobile-friendly interface.
