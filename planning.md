# Project Planning — EcoCycle AI

## Objective

Deliver a stable, explainable, end-to-end hackathon demonstration within the GRAVITON 24-hour coding window.

## Priority system

### P0 — Must work
- Homepage and navigation.
- PET waste listing form.
- Input validation and confirmation of submitted details.
- Analysis result display. Use a real vision-capable API only if configured and tested; otherwise clearly label the fallback as demo/manual analysis.
- At least three clearly labelled demo buyer profiles with different acceptance requirements.
- Deterministic matching and visible reasons for match ranking.
- A result page that works from beginning to end.

### P1 — Add after P0 works
- Listing history and statuses.
- Impact dashboard with only real/test clearly labelled counts.
- Mobile responsiveness and visual polish.
- Better error messages and empty states.

### P2 — Only if time remains
- Optional additional waste categories.
- More detailed buyer profile pages.
- Filters or search.
- A small admin/demo reset control, if safe and useful.

## Deliverables

1. Working web application or a stable locally hosted demo.
2. One complete user journey from waste submission to match result.
3. Transparent ranking and explanation.
4. Clearly labelled sample buyer records and any simulated data.
5. Test checklist with results.
6. Short presentation and rehearsed demo.
7. Repository with event-period development history, as required by organisers.

## Four-person responsibility model

Adjust these roles based on actual team strengths and ensure all members can explain the whole product.

| Member | Primary responsibility | Secondary responsibility |
|---|---|---|
| Member 1 | Frontend: home, form, layout, responsiveness | UX testing and accessibility |
| Member 2 | AI analysis integration or clearly labelled fallback | Prompt/API testing and confidence/uncertainty display |
| Member 3 | Backend/data model and buyer matching | Validation and status handling |
| Member 4 | Integration, test coordination, dashboard and pitch | Git coordination and demo rehearsal |

No person should work in isolation until late in the event. Integrate early and often.

## Dependencies

- Frontend form determines the data fields needed by the backend.
- AI analysis must return a structured estimate that the user can review.
- Matching needs confirmed material, quantity, location, and condition.
- Dashboard counts depend on listing statuses being recorded consistently.
- Demo depends on working sample buyer records and a resettable starting state.

## Work sequence

1. Confirm event start, code-freeze time, team size, theme, and submission rules.
2. Initialise the permitted repository at official hacking start.
3. Agree on a minimal interface and data contract before parallel coding.
4. Build the form and static page flow first.
5. Connect submission to data handling and buyer matching.
6. Add AI image analysis if practical, without blocking the end-to-end demo.
7. Add status updates and dashboard only after the core journey works.
8. Run the full test checklist and practise the pitch.
9. Stop feature work at the internal freeze; use remaining time for bug fixes and rehearsal.

## Risk register

| Risk | Impact | Mitigation / fallback |
|---|---|---|
| AI API unavailable, slow, or quota-limited | Core flow blocked | Provide a clearly labelled manual/demo analysis path; never pretend it is live AI. |
| API key exposed in frontend or repository | Security risk | Keep secrets server-side or in environment variables; rotate any exposed key. |
| Team integration starts too late | Merge conflicts and broken demo | Define interfaces early; integrate a thin end-to-end slice by H+4. |
| Too many material categories | Scope expansion | Keep PET bottles as the only required category. |
| Fake buyers mistaken for real companies | Trust and judging concern | Mark every sample buyer as fictitious/demo data. |
| Ranking feels arbitrary | Weak product differentiation | Show the criteria, weights, input values, and reasons. |
| Dashboard overstates impact | Misleading claim | Separate listed, matched, collected, and verified recovered amounts. |
| Laptop/internet instability | Demo disruption | Keep a local demo path and a small, clearly labelled local dataset. |
| Team cannot explain generated code | Judging concern | Review every file and have its owner explain it in plain language. |

## Scope-change rule

A new feature is accepted only if P0 is complete, it can be implemented and tested safely within the remaining time, and it does not threaten the demo. Otherwise record it as future work.
