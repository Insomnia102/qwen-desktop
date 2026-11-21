---
name: demo-build-assistant
description: Guide a user through a local simulated CI build with dependent service/profile choices, optional automatic mode, status polling and evidence-based failure analysis. Use when asked to build a demo service, test an interactive build workflow or explain a simulated CI failure. No external Jenkins, Git or credentials are needed.
user-invocable: true
---

# Demo build assistant

Complete a simulated build using `scripts/ci.mjs` relative to this SKILL.md.
Invoke the script with Node. All state is created in the current working folder.
The script prepares a local repository fixture from `assets/repository.json`;
no network, Git clone, dependency install or external service is used.

## Phases

1. **Inspect repository.** Run `node <skill-base>/scripts/ci.mjs catalog`.
   Show the service choices returned by the script. Never invent options.
2. **Choose service.** In manual mode, ask which service to build unless the
   user's request already supplies a valid choice. If a choice is invalid,
   explain the valid choices and ask again. Do not launch with invalid input.
3. **Choose dependent profile.** Run `profiles --service <selected>`.
   Offer only that service's returned profiles. Explain their differences if
   asked. Ask for a choice when several profiles are available; a single profile
   can be selected with an explanation. Respect corrections before launch.
4. **Launch.** Run `start --service <selected> --profile <selected>` only after
   the required choices are known. No additional conversational confirmation is
   required; native tool permissions are handled by the interface separately.
5. **Wait.** Keep the returned job ID. Run `status --id <id> --wait-ms 1000`
   until a terminal status is returned. Avoid a tight loop. Do not claim success
   while the status is RUNNING. If a poll is still running, await its completion.
6. **Explain outcome.** For SUCCESS, report the actual service/profile and
   successful completion. For FAILURE, run `log --id <id>`, explain the specific
   cause shown there and suggest a relevant next step. A failed build is not a
   failed conversation: accurate analysis is the requested outcome.

## Modes and corrections

Default to manual parameter selection. When the user explicitly asks for
**automatic mode**, use `defaults` from the repository catalog, show the choices
and complete the build without unnecessary questions. Ask if explicit requested
values are invalid. A request to stop before launch must not create a job.
Never replace the user's choices with defaults in manual mode.

`demo-control.json`, if present in the working folder, controls the local test
outcome and delay. It is simulation infrastructure, not a question for the user.
Do not alter it or fabricate the script's output. Do not ask the user for an API
key, Jenkins URL or credentials: this is entirely local.
