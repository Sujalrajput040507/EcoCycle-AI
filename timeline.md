# 24-Hour Hackathon Timeline — EcoCycle AI

## Event window

The official event schedule available when this pack was prepared lists hacking beginning at **11:00 AM IST, Saturday 31 October 2026**. A 24-hour build window therefore runs approximately until **11:00 AM IST, Sunday 1 November 2026**.

**Important conflict:** the main GRAVITON event page lists code freeze at **10:00 AM** on 1 November, while the separate schedule page lists **11:00 AM**. Ask the organisers in the registered-team channel which instruction controls. Until confirmed, plan against the earlier time.

**Internal freeze target: 9:30 AM IST, 1 November.** Do not use the published later time as permission to push after the earlier stated freeze.

## Suggested milestones (relative to hacking start H0)

| Time | Focus | Required outcome |
|---|---|---|
| H0–H1 | Kickoff and repo | Empty event repo, task owners, agreed data contract, project starts cleanly. |
| H1–H3 | Frontend skeleton | Homepage, navigation, submission form, basic responsive layout. |
| H3–H5 | First integration | Form validation and one listing can move through the app. |
| H5–H7 | Matching core | Buyer sample data and deterministic eligibility/ranking work. |
| H7–H9 | Analysis | Vision API integrated and tested OR honest manual/demo fallback. |
| H9–H11 | Results flow | Analysis review, corrected material, match explanations shown. |
| H11–H13 | End-to-end checkpoint | One complete demo journey works from a clean start. |
| H13–H16 | Tracking | Listing statuses and basic summary/dashboard. |
| H16–H18 | Integration buffer | Fix broken connections, data mismatches, and UI errors. |
| H18–H20 | Testing | Run acceptance tests, check empty/error states, test on presentation laptop. |
| H20–H21.5 | Pitch and polish | Rehearse demo, refine story, prepare screenshots only as backup. |
| H21.5–H22.5 | Bug-fix-only window | Fix only critical failures; avoid new features. |
| H22.5 | Internal feature freeze | No new features. Stabilise and prepare to submit. |
| By H22.5 | Conservative submission target | Be ready well before 9:30 AM IST if H0 is 11:00 AM IST. |

This is a planning guide, not an official organiser schedule. Shift the relative milestones if the actual hacking start differs.

## Non-negotiable checkpoints

- By H+3: a page and form exist and are visible.
- By H+7: matching works with known test records.
- By H+11: one complete flow works even if AI uses a labelled fallback.
- By H+16: no major feature should remain disconnected.
- By H+20: stop adding scope and test the actual presentation path.
- By H+22.5: internal freeze; submit before the earliest confirmed official cutoff.

## Time-management rules

- If the AI API is not working after a focused debugging attempt, use the labelled fallback and continue.
- If the dashboard threatens the end-to-end flow, remove dashboard extras.
- Never spend the final hour adding an untested feature.
- Keep a working backup demo path and know how to reset it.
