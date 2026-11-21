# Qwen Desktop Skills Lab scenarios

A suite is JSON with version 1. The application binds skillId and the source
workspace during import; do not invent internal IDs or put credentials in suites.
Inputs are UTF-8 text files, each given a safe relative path. Hidden Qwen, agents,
Git, node_modules or .mcp.json paths are reserved. Outputs use paths relative to the new
scenario workspace. Each case gets a fresh session and files, with no chat history.
A workspace is not an operating-system sandbox: shell and MCP follow permissions.

```json
{
  "version": 1,
  "name": "Example skill checks",
  "skillName": "example-skill",
  "scope": "user",
  "invocation": "explicit",
  "permissionMode": "auto-edit",
  "useMcp": false,
  "timeoutSeconds": 180,
  "maxTurns": 30,
  "maxToolCalls": 80,
  "cases": [
    {
      "id": "basic",
      "name": "Build a report from input",
      "prompt": "Process input/data.json and save output/report.json.",
      "files": [{"path": "input/data.json", "text": "{\"items\":[1,2,3]}"}],
      "checks": [
        {"kind": "file-exists", "path": "output/report.json"},
        {"kind": "json-equals", "path": "output/report.json", "pointer": "/count", "value": 3}
      ]
    }
  ]
}
```

Use the actual generated skill name as skillName. Allowed check kinds:

- `file-exists`, `file-absent`: `path`.
- `file-contains`, `file-equals`: `path` and string `value`.
- `json-equals`: `path`, JSON Pointer `pointer` and any JSON `value`.
- `answer-contains`: a short string `value`; avoid requiring exact long prose.
- `tool-used`: `value` is a native Qwen tool name such as `run_shell_command`;
  only successful completed tool calls count.
- `skill-used`: boolean `value`. In `auto` invocation mode this checks whether
  a skill call or reading the under-test SKILL.md was observed. In `explicit`
  mode the skill is intentionally supplied and this is not an activation test.

Create 1–20 cases per suite, 1–100 checks per case, at most 40 input files per case,
with at most 1 MB of input text across the suite. Per-scenario limits: 15–7200 seconds,
1–100 model turns and 1–200 tool calls. Permissions are `default`, `auto-edit`, `yolo`.
Prefer `auto-edit` and leave MCP off unless the task genuinely requires it.
Don't use arbitrary evaluation code or shell expressions as check definitions.

## Interactive dialogue suites

For skills that ask follow-up questions, use an optional `dialogue` object on a
case and allow `checks: []`. Do not prescribe a rigid sequence of answers.

```json
{
  "id": "manual-build",
  "name": "Dependent choices",
  "prompt": "Build a demo service in manual mode.",
  "files": [],
  "checks": [],
  "dialogue": {
    "mode": "ai",
    "persona": "Choose api. Ask how the offered profiles differ, then choose full. Do not invent options.",
    "criteria": [
      "Agent gathers required parameters before launch.",
      "Actual launch arguments match the user's choices.",
      "Final outcome is supported by tool results."
    ],
    "maxMessages": 12,
    "replyTimeoutSeconds": 1800
  }
}
```

Use `mode: "manual"` for the real user to answer. The AI user and reviewer have
no tools or permission authority. Criteria are supplied to the reviewer, not to
the tested agent. A human reply pauses the active execution time budget and has
a separate 30–7200-second waiting limit. There are at most 40 agent replies and
20 requirements per case. Native permissions remain independent of dialogue mode.
