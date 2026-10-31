# Testing and Acceptance Checklist — EcoCycle AI

Use these checks during the event. Mark each as PASS, FAIL, or NOT TESTED and note the person who tested it. Do not mark a test PASS without running it.

## Homepage and navigation

- [ ] Home page opens without a console-breaking error.
- [ ] Brand and tagline are visible and readable.
- [ ] Main call to action leads to the waste submission flow.
- [ ] Navigation links lead to the correct sections/pages.
- [ ] Layout remains usable on the laptop presentation size and a narrow mobile viewport.

## Waste submission

- [ ] Valid PET bottle image can be selected.
- [ ] Unsupported file type is rejected with a useful message.
- [ ] Missing required information is identified.
- [ ] Quantity must be a positive number.
- [ ] Unit is displayed consistently.
- [ ] Submitted data is shown back to the user for review.
- [ ] Image or analysis failure does not crash the whole application.

## Analysis and correction

- [ ] AI output is labelled as an estimate.
- [ ] Manual/demo fallback is explicitly labelled as such.
- [ ] Unclear/low-quality input gives a useful warning or correction option.
- [ ] User can confirm or correct the material category.
- [ ] The confirmed material, not an unreviewed guess, is used for matching.

## Buyer matching

- [ ] Sample buyers are labelled as fictitious/demo profiles.
- [ ] Buyer acceptance rules are applied consistently.
- [ ] Buyer that rejects the material is not presented as a fully eligible match.
- [ ] Quantity boundaries behave correctly (below minimum, at minimum, in range, above maximum).
- [ ] A missing data field is not silently treated as a perfect score.
- [ ] Score breakdown adds up correctly under the documented policy.
- [ ] Explanation matches the buyer data and computed score.
- [ ] No eligible buyer produces a clear empty state rather than a fabricated match.

## Listing status and dashboard

- [ ] New listing begins at LISTED.
- [ ] Matching changes status only when a match is actually selected/recorded.
- [ ] Collection is a separate status.
- [ ] Recovery is not counted as verified without evidence.
- [ ] Dashboard totals agree with the underlying sample records.
- [ ] Simulated values are labelled as demo data.

## Reliability and security

- [ ] App works from a clean start using the documented run steps.
- [ ] No API key or secret is present in public frontend code or Git history.
- [ ] API failure produces a controlled message/fallback.
- [ ] No personal data is requested unnecessarily.
- [ ] Browser refresh/back navigation does not break the main demo path.
- [ ] A fresh demo can be run without relying on stale previous data.

## Final presentation rehearsal

- [ ] One person can run the full demo without improvising hidden steps.
- [ ] Each team member can explain their own contribution.
- [ ] At least two members can explain the matching formula and why the AI does not decide the ranking.
- [ ] Team can state what is live, what is simulated, and what is future work.
- [ ] Team can explain the limitation of image-based material identification.
- [ ] Team knows the final official code-freeze and submission instructions.
