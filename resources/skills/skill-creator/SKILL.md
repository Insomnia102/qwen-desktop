---
name: skill-creator
description: Create, improve and package reusable multi-file skills. Use when the user wants a new skill, clearer instructions, scripts and references, realistic test scenarios, or improvements based on test results. Adapted from Anthropic's skill-creator for Qwen Desktop and Skills Lab.
---

# Skill Creator for Qwen Desktop

This is a Qwen Desktop adaptation of Anthropic's skill-creator. The complete
upstream guide, agents, scripts, review assets and Apache-2.0 license are bundled
alongside this file. See `UPSTREAM_SKILL.md` for the original writing guidance and
`references/qwen-desktop.md` for the Desktop scenario format.

## Establish the task

Understand what the skill should do, what user requests should activate it,
which input files and tools it needs, and what a correct result looks like.
Use the requirements already supplied by the user. If an essential detail is
missing, ask a plain-text question and stop; do not invent business rules.
For a request from the Desktop creator form, prefer delivering a usable first
package and explain any assumptions in your final response.

## Create the package

1. Use a lowercase name with letters, digits and hyphens, at most 64 characters.
2. Create `<name>/SKILL.md` with YAML `name` and `description`, followed by concise
   actionable instructions. Put activation cues in the description.
3. Add scripts for deterministic or repeated operations, references for detailed
   rules, and assets for templates. Link each useful resource from SKILL.md.
4. Preserve the user's existing skill name and custom metadata when improving
   an existing package. Work on a copy when a test or generation task provides one.
5. Keep downloaded repositories, generated reports, virtual environments and
   dependency caches in the working directory or a cache outside the skill.
   Add a `.skillignore` with exact relative folder paths when editor-only exclusions
   are useful. Do not exclude resources needed to execute the skill.
6. Prefer already installed runtimes. Node.js is available in Desktop; Python,
   extra npm packages, remote repositories and MCP servers are prerequisites only
   when the user explicitly needs them. Do not install global packages.

Keep the main instructions short enough to read when the skill activates.
Explain why important steps matter. Put long domain details in references and
make expected output schemas explicit. Do not add arbitrary filler files.

## Validate resources

Run deterministic scripts on small local examples where possible. Check both
normal inputs and at least one failure or edge case. Inspect produced files;
a successful process exit or a confident final response is not proof of correctness.
Preserve executable file permissions when needed and use portable paths.
Never claim that a model-powered scenario passed unless it actually ran.

## Generate Desktop test scenarios

Write `<name>/evals/suite.json` in the format in `references/qwen-desktop.md`.
Include 2–4 realistic, independent scenarios. Each needs input fixtures, a task
prompt, and objective checks. Cover a normal case and an error or boundary case.
Use file-content and JSON checks instead of exact prose whenever possible.
Do not place expected answers in input fixtures where the model could copy them.
Scenarios should work without external downloads unless those are explicitly
part of the user's task. Give each scenario a stable ID.

Desktop handles independent Qwen sessions, permissions, input staging, time limits,
checks, run history and artifact review. The user imports and launches the suite
in Skills Lab after reviewing the generated skill.

## Qwen execution integration

- Use the current Qwen tools and selected model. Claude Code is not required.
- Do not run the bundled upstream `scripts/run_eval.py`, `scripts/run_loop.py`
  or `scripts/improve_description.py` as a Desktop evaluation engine: those original
  helpers depend on Claude interfaces. They are retained for provenance and for
  users who separately run upstream tooling in its supported environment.
- Use Desktop's scenario JSON for Qwen evaluation. Do not create `.claude/commands`
  or spawn `claude -p` to approximate a Qwen test.
- Do not start the bundled external HTML reviewer in a Desktop generation task;
  the application shows outputs, checks and artifacts in its own interface.
- Write outputs only in the supplied workspace. Do not install or overwrite a
  real user/project skill as part of generation. Desktop offers a separate
  installation action after inspection.
- Shell commands follow the current permission mode. If approval is denied,
  explain which step could not be completed and retain useful files.

Finish by listing the generated package path, main capabilities, test suite path,
and actual prerequisites or checks you could not run.
