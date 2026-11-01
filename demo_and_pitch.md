# Demo and Pitch Plan — EcoCycle AI

## 60–90 second product explanation

“EcoCycle AI helps waste generators find a suitable next destination for recyclable material. Instead of simply posting waste in a generic marketplace, a user submits the material, confirms an AI-assisted estimate, and receives buyer matches based on compatibility, quantity, location, demand, and condition. The key idea is explainable matching: users can see why a buyer profile fits. We start with PET plastic bottles to demonstrate one complete, reliable journey.”

Adjust this wording to describe only the features that actually work in the final build.

## Suggested live demo sequence

1. Start from the homepage and explain the problem in one sentence.
2. Open the waste submission form.
3. Submit a prepared PET bottle example image and enter a realistic demo quantity and non-sensitive area.
4. Show the AI estimate or clearly labelled manual/demo fallback.
5. Confirm or correct the material.
6. Show ranked buyer profiles and open the reason breakdown.
7. Select a match and show the listing status.
8. Show the dashboard and explain which values are sample data and which, if any, are verified.
9. Close with the limitation and future scope.

## Story to emphasise

- Waste generators need a suitable next destination, not just another listing form.
- Buyer requirements differ by material, quantity, location, and condition.
- EcoCycle makes these compatibility factors visible.
- AI supports material estimation; deterministic logic controls the ranking.
- The MVP intentionally focuses on one material category for reliability.

## Likely judge questions

**What is innovative compared with a normal waste marketplace?**  
The differentiator is transparent compatibility-based matching using buyer acceptance criteria, not merely placing waste advertisements online.

**Why use AI?**  
A vision-capable model can assist with an initial material estimate from an image. The user can correct it, and the app uses the confirmed material for matching. AI is an assistive step, not the authority for buyer ranking.

**How do you calculate the match?**  
Explain the documented factors and weights, then show a real score breakdown from the running application. Be prepared to explain hard eligibility checks and missing data handling.

**Are the buyers real?**  
Answer truthfully. If profiles are sample records, say clearly that they are fictitious demo profiles used to demonstrate the matching workflow. Do not imply a partnership.

**How do you know the waste was recycled?**  
A listing or match alone does not prove recycling. The app separates listed, matched, collected, and verified recovered statuses. Only supported recovery records count as verified.

**How accurate is the image recognition?**  
It is an estimate affected by image clarity, lighting, contamination, and model limitations. The user can review and correct it. Do not claim an accuracy percentage without a real evaluation dataset and measured results.

**What happens if there is no suitable buyer?**  
The app explains that no profile currently meets the requirements and lets the user revise details or wait for another buyer. It should not invent a match.

**What is next?**  
Verify real recycler data and expand to additional materials only after validating the PET workflow. Pickup coordination and broader analytics are future possibilities, not claims about the current MVP.

## Demo safety checklist

- Use sample data that is labelled.
- Remove or avoid personal information from screenshots.
- Do not show secret keys or provider dashboards containing credentials.
- Reset to a known starting state before the presentation.
- Never claim simulated transactions or estimates are real-world outcomes.
