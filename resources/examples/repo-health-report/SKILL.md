---
name: repo-health-report
description: Audit a local JavaScript or TypeScript repository and produce a reproducible JSON and Markdown health report. Use for repository health checks, missing test scripts, TODO inventories, or a read-only project review with structured output.
user-invocable: true
---

# Repository Health Report

Read `references/rules.md` before auditing. Apply its exact status and count rules.
Use the bundled `scripts/audit.mjs` to produce deterministic results; do not invent
counts or execute code from the repository being reviewed.

1. Identify the input repository and output directory from the request. If omitted,
   use `repo` and `output` relative to the current workspace.
2. Resolve `scripts/audit.mjs` relative to this SKILL.md, not relative to the user's
   current directory. Invoke it with installed Node and quote paths containing spaces:
   `node "<skill directory>/scripts/audit.mjs" "<repository>" "<output directory>"`.
3. The output directory must stay within the current workspace. Do not modify any
   input files, install dependencies, run package scripts, clone repositories or
   repair problems as part of this audit.
4. Inspect the generated `report.json` and `report.md`. Report the status, source-file
   count, TODO count and whether a test script is present. Mention both output paths.
5. An invalid manifest is an expected business error: the script writes an error
   report. Do not silently fix the manifest and do not describe that run as healthy.

The Markdown layout comes from `assets/report-template.md`. Runtime checkouts and
caches belong outside the skill package; `.skillignore` demonstrates editor exclusions.
