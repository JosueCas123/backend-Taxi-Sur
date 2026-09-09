---
name: spec-verify
description: Verifica los criterios de aceptación de un spec implementado, los corrige y marca los checks con evidencia. Clasifica cada criterio, inspecciona el código, usa Context7 para validar recomendaciones actuales de Node.js/Express y deja la checklist real.
disable-model-invocation: true
argument-hint: '<NN-spec-name>'
allowed-tools: Read, Glob, Grep, Edit, Write, AskUserQuestion, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(cat:*), Bash(ls:*), Bash(npm test:*), Bash(npm run build:*), Bash(npx prisma:*), Bash(node:*)
---

# /spec-verify — Verifier of acceptance criteria

## Session context

Today's date:
!`date +%F`

Specs available in this folder:
!`ls specs/ 2>/dev/null || echo "The specs/ folder does not exist"`

Current repository state:
!`git status --short`

Current branch:
!`git branch --show-current`

---

## Instructions

Follow these phases in strict order. **Do not advance to the next phase if the previous one did not complete correctly.**

Your replies must be in the same language as the spec and the user's request (e.g. Spanish spec → Spanish report).

You are a **verifier**, not an implementer. You do not write application code. Your only edit is the acceptance criteria checklist of the spec.

---

### Phase 1 — Identify the spec

The received argument is: `$ARGUMENTS`

If `$ARGUMENTS` is empty:

- List the files available in `specs/` (you already have them above).
- Ask the user to specify the exact name of the spec.
- Stop and wait for an answer. Do not continue.

If `$ARGUMENTS` has a value:

- Look for the file in `specs/`. The user may have written the full name (`02-migracion-schema-prisma`), only the number (`02`), or only the slug (`migracion-schema-prisma`). Try to find the correct file in any of those cases.
- If you do not find the file, show the available specs and ask the user to correct the name.
- If you do find it, continue to Phase 2.

---

### Phase 2 — Validate the spec's state

Read the spec file you located in Phase 1 using the Read tool.

In the file's contents, look for the line that contains the spec's state. The header label is typically `**Status:**` (English) or `**Estado:**` (Spanish), but it may use any language. Match by position (status line near the top of the spec) and by the surrounding state machine, not by the exact label.

**Absolute rule:** You can only continue if the state **means "Implemented"** — regardless of the language used. Verification happens after implementation, not on a plan.

Treat any of the following (and their equivalents in other languages) as the **Implemented** state and continue:

- English: `Implemented`
- Spanish: `Implementado`
- Portuguese: `Implementado`
- …or any other language's word that clearly means "implemented"

Anything else (Draft / Borrador, In review / En revisión, Approved / Aprobado, Obsolete / Obsoleto, or any unrecognized value) means **stop** and show the error message below.

| State category                            | Examples (any language)                           | Action                                                        |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Implemented                               | `Implemented`, `Implementado`, …                  | Continue to Phase 3.                                          |
| Approved / Aprobado (still not built)     | `Approved`, `Aprobado`, …                         | Stop. Tell the user this spec is approved but not implemented. |
| Draft                                     | `Draft`, `Borrador`, …                            | Stop. Show the error message below.                           |
| In review                                 | `In review`, `En revisión`, …                     | Stop. Show the error message below.                           |
| Obsolete                                  | `Obsolete`, `Obsoleto`, …                         | Stop. Show the error message below.                           |
| State line not found / unrecognized value | —                                                 | Stop. The file does not follow the expected format.           |

If you are unsure whether a value means "implemented", **do not assume**. Stop and ask the user to clarify or to update the spec to the canonical wording.

**Standard error message when the state does not mean Implemented:**

```
❌ I cannot verify this spec.

Current state: [STATE FOUND]
I only work with specs whose state means "Implemented"
(e.g. `Implemented`, `Implementado`, or the equivalent in another language).

To continue you have two options:
  1. If the implementation is done, change the state to "Implemented"
     (or the equivalent term your team uses) manually.
     That change is made by the human, not the agent.
  2. If the implementation has not started yet, use /spec-impl to build it first.
```

Do not offer alternatives to skip this gate. The block is intentional.

---

### Phase 3 — Read the spec and extract the acceptance criteria

Read the full spec. You need the whole context, not just the checklist:

- The **objective** (line after `**Objective:**` / `**Objetivo:**` / equivalent).
- The **scope** (`## Scope` / `## Alcance` / equivalent) — what is in and what is deliberately out.
- The **implementation plan** (numbered steps) — what the implementation was supposed to do.
- The **listed files** — where the changes should live.
- The **acceptance criteria** (`## Acceptance criteria` / `## Criterios de aceptación` / equivalent).

Match section headings by meaning, not by exact wording — the spec may be authored in any language.

Extract every checklist line. Each line has the form `- [ ]` or `- [x]` followed by a statement. A criterion is the whole statement: mark it `- [x]` only if the statement is **fully** satisfied, `- [ ]` otherwise. If a line contains several verifiable claims, every claim must pass for the criterion to pass.

Also check the referenced project docs (e.g. the `references` defined in the repo, such as `../docs`) when a criterion says something must comply with a documented rule.

If the spec has **no acceptance criteria section**, stop and tell the user: the spec is not verifiable without a boolean checklist. Do not invent criteria.

---

### Phase 4 — Verify each criterion one by one

For every criterion, classify it and verify it with **real evidence**. Never mark a check based on memory, intuition, or "it looks right".

#### 4.1 Code / structure / data criteria

Inspect the actual files and run the actual commands:

- Read the relevant files with Read.
- Verify DB-related criteria with the real schema and commands (`npx prisma validate`, `npx prisma migrate status`, `npx prisma studio` is for humans — use status/diff instead), or read `prisma/schema.prisma` and the applied migrations inside `prisma/migrations/`.
- Verify runtime/build criteria with the real commands (`npm run build`, `npm test`, or a concrete `node` invocation). Do not claim a build passes without running it.
- Check git state when the criterion depends on the current branch or committed files.

#### 4.2 Library best-practice criteria (Node.js / Express / etc.)

When a criterion depends on following current recommendations for a library or framework (Express, Prisma, Zod, jsonwebtoken, Node.js itself…), **you must use Context7**. Do not rely on your training cut-off:

1. Call `context7_resolve-library-id` with the library name and the specific thing the criterion is about.
2. Call `context7_query-docs` with the selected library ID and the same scoped question.
3. Compare what the implementation actually does against the current documented recommendation.
4. Record the docs consulted as evidence.

If Context7 is unavailable, say so explicitly in the report and leave the criterion unchecked — do not substitute memory for documentation.

#### 4.3 UI / screen criteria

If a criterion requires looking at a rendered screen:

- Check whether any browser/Playwright MCP tool is available in this session. If it is, use it to open the screen and take a screenshot, then inspect it with your vision capability.
- If it is **not** available (the likely case in this backend-only project), leave the criterion **unchecked** and explain in the report: screen verification requires the frontend project and a Playwright/browser MCP. Do not mark it as passed from static code inspection alone.

#### Evidence rule

For a criterion to be `[x]`, you must be able to point to:

- The file and line where the behavior is implemented, and/or
- The command output that proves it (build, tests, prisma status).

If you cannot produce either, the criterion stays `[ ]`.

---

### Phase 5 — Mark the checklist

Edit the spec file using the Edit tool — **only** the acceptance criteria section:

- `- [ ]` → `- [x]` for every criterion that passed with evidence.
- Leave `- [ ]` unchanged for every criterion that failed or could not be verified.
- **Never modify** the objective, scope, data model, implementation plan, decisions, risks, or the state line.
- **Never change** the wording of a criterion. If a criterion is badly written (subjective, ambiguous, or not boolean), do not rewrite it: leave it unchecked and flag it in the report so the user can fix the spec with /spec.

Apply all checkbox changes, then read the section back to confirm the edit is correct.

---

### Phase 6 — Report

Present a final report with three parts:

1. **Checklist result** — a table: `Nº | Criterio (abbreviated) | Result | Evidence`.

   Use `PASS` / `FAIL` / `NOT VERIFIABLE`. For every row give the concrete evidence (file:line, command output, or docs consulted via Context7).

2. **Failing criteria** — list each failing/flagged criterion and the precise reason. Do not fix them.

3. **Next step** — state clearly:

   - If all criteria pass: the spec is verified. Suggest (do not do it yourself) that the user makes the final commit.
   - If some criteria fail: suggest re-running `/spec-impl` to fix the remaining work, or opening a new spec if the gap is out of scope.

**Stop here.** Do not implement fixes, do not refactor, do not touch git, do not change the spec's state.

---

## Hard rules

- **Never mark `[x]` without concrete evidence.** Evidence is a file:line, a command output, or a docs reference from Context7. No exceptions.
- **Never modify anything outside the acceptance criteria checklist**, including the state line.
- **Never rewrite or invent criteria.** A bad criterion is reported, not corrected.
- **Always use Context7 for library recommendation criteria.** Never answer those from memory.
- **Never claim a screen was verified without a browser tool.** Static inspection is not enough.
- **Never implement, fix, or refactor code.** You verify and report.
- **Never change git state** (no commits, no branches).
- If you are missing information to verify a criterion, say exactly what you are missing instead of assuming.

## Arguments

`$ARGUMENTS` is the spec reference. It can be the full file name, the number, or the slug. If it is missing, list the specs and ask.

## Summary of expected behavior

```
/spec-verify 02-migracion-schema-prisma

  Phase 1  →  Finds specs/02-migracion-schema-prisma.md
  Phase 2  →  Reads the state → "Implementado" → ✅ continues
  Phase 3  →  Reads scope, plan, files and extracts the 13 criteria
  Phase 4  →  Verify each criterion (code inspection, real commands, Context7)
  Phase 5  →  Marks only the passed checks as [x], leaves the rest unchecked
  Phase 6  →  Report table with PASS/FAIL/NOT VERIFIABLE + evidence, stops

/spec-verify 02-migracion-schema-prisma  (state: Draft / Borrador)

  Phase 1  →  Finds the spec
  Phase 2  →  Reads the state → "Draft" → ❌ stops with the error message
              Does not mark anything, does not touch the file
```