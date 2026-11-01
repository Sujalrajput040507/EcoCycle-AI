# Decisions, Assumptions, and Open Questions — EcoCycle AI

## Current working decisions

| Area | Current decision | Reason |
|---|---|---|
| Initial material | PET plastic bottles | Keeps scope small enough for a 24-hour build. |
| Core workflow | Upload → estimate → confirm → match → track | Demonstrates the complete value proposition. |
| AI role | Material/visible-condition estimate only | AI should assist, not invent buyer scores or business facts. |
| Match ranking | Deterministic weighted scoring plus hard eligibility rules | Transparent and testable. |
| Frontend | Plain HTML/CSS/JavaScript by default | Fits beginner team experience and reduces setup time. |
| Backend | Small Node/Express service if the team can maintain it | Keeps API keys away from the browser and separates logic. |
| Database | Local/in-memory sample data first | Avoids database setup risk in a short event. |
| Buyer data | Fictitious sample profiles unless verified | Avoids false claims of real partnerships. |
| Deployment | Local demo first; deployment only if time permits | Reliability is more important than a hosting badge. |

## Assumptions to verify at event start

- The registered team size, selected theme, and submission requirements are confirmed.
- Organisers permit the planning documents to be copied into the event workspace/repository.
- The team has working internet access and the selected AI provider can be called from the event network.
- Any chosen API key/account is allowed under the event and provider terms.
- The final code-freeze time is confirmed by organisers.
- At least one team member can operate the laptop and development environment reliably.

## Event schedule discrepancy

The main GRAVITON event page currently shows 10:00 AM IST code freeze on 1 November 2026, while the separate official schedule page shows 11:00 AM IST. Confirm with organisers. Use 9:30 AM as the internal stop target unless an even earlier instruction is given.

## Explicitly deferred decisions

- Which specific vision API to use, based on availability, cost/credits, speed, terms, and response format.
- Whether a small database is genuinely required after the first end-to-end flow works.
- Whether the application needs deployment beyond the local presentation laptop.
- Whether any additional material category can be safely added without harming stability.

## Questions to settle in the first hour

1. What exact event rule defines the start of coding and submission repository requirements?
2. What is the final code-freeze time and submission method?
3. Which team member owns the shared integration branch/repository?
4. What is the smallest common data contract for a waste listing and buyer profile?
5. Is the AI API usable within the event's time and connectivity constraints?

## Scope exclusions — do not add without a team decision

Blockchain, custom model training, IoT, payment gateway, live logistics, live price feeds, complex authentication, large multi-material catalogue, and unverified impact calculations.
