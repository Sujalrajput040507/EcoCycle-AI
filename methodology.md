# Development Methodology — EcoCycle AI

## Working style

Use a short-cycle, end-to-end development approach. The team should always have a runnable version, even if some functions are still placeholders. A small working flow is more valuable than many disconnected screens.

## Before the official start

Allowed preparation, subject to the organiser's final rules:
- Read and discuss project documentation.
- Learn HTML, CSS, JavaScript, APIs, Git, and Antigravity using unrelated practice exercises.
- Sketch screens and agree on wording and user journey.
- Discuss architecture, matching criteria, data fields, test cases, and division of responsibilities.
- Install and test development tools without creating the EcoCycle submission implementation.

Do not create EcoCycle app source code, a working prototype, or files intended to be copied as the submission implementation before hacking starts.

## At the official start

1. Reconfirm the exact hacking start and freeze time with organisers.
2. Create the event repository from an empty starting point if required by the rules.
3. Add the approved planning documents if permitted.
4. Agree on shared names and the minimal data contract.
5. Assign owners and begin implementation.

## Small task cycle

For every feature:
1. State the user-visible behaviour.
2. Agree on inputs, outputs, and error cases.
3. Identify the files and owner.
4. Ask Antigravity to make one focused change.
5. Review the diff before accepting it.
6. Run the feature and test normal and invalid inputs.
7. Ask the owner to explain the code in plain language.
8. Commit the tested change using ordinary event-period version-control history.

## Team integration

- Integrate a minimal page and form early.
- Agree on field names before different members build dependent parts.
- Merge small changes frequently; avoid separate untested branches lasting for hours.
- Keep one person responsible for integration conflicts and final demo stability.
- Do not all edit the same file at the same time unless coordinated.

## Antigravity usage

Good requests are specific, bounded, and testable. Ask the agent to inspect the existing project first, explain its proposed edits, and avoid unnecessary dependencies. Do not accept a large generated code dump that nobody can explain.

Useful task-request structure:
- Context: the relevant screen or feature.
- Desired behaviour: what the user should be able to do.
- Constraints: existing stack, beginner-friendly, no secrets in client code.
- Acceptance criteria: observable conditions that prove completion.
- Request: inspect first, explain a small plan, implement, run checks, and summarise files changed.

## Quality gates

- **Gate 1:** page loads and navigation works.
- **Gate 2:** user can submit valid details and sees validation errors for invalid details.
- **Gate 3:** analysis result is clearly identified as AI-generated, manual, or demo.
- **Gate 4:** buyer ranking is deterministic and the explanation matches the displayed inputs.
- **Gate 5:** status changes do not falsely count a listing as recovered.
- **Gate 6:** entire demo works from a clean starting state.

## Communication rules

- Share blockers as soon as they arise.
- If a feature is taking too long, state what works and switch to the documented fallback.
- No one should claim a feature is complete based only on a screenshot or generated code; run it.
- Keep a short list of known limitations for the presentation.
