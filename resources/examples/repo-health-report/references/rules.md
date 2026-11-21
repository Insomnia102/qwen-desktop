# Audit rules

- A valid package.json must be a JSON object. Its name becomes report.project.
- A non-empty scripts.test is present unless it is the npm "no test specified" placeholder.
- Count regular .js, .jsx, .ts, .tsx, .mjs and .cjs source files, including files in subfolders.
- Count occurrences of the whole word TODO, case-insensitively. Count two TODOs on
  one line as two. Never scan .git, node_modules, dist, .cache or .venv.
- Do not follow symlinks. Inspect at most 5,000 directory entries and text files
  up to 512 KB. A limit violation produces an error report, not a partial healthy report.
- Status is passed if there are no issues; warning if tests are missing or TODOs
  exist; error if input is unreadable or package.json is malformed.
- report.json includes schemaVersion, project, status, summary and issues.
  summary includes sourceFiles, todoCount, hasTestScript and ignoredEntries.
- Issue codes: NO_TEST_SCRIPT, TODO_FOUND, INVALID_MANIFEST, INPUT_UNAVAILABLE,
  LIMIT_EXCEEDED. A report with error status can still be successfully written.
- Inputs are read-only. Output is report.json and report.md under the requested
  output directory. Output paths outside the current workspace are rejected.
