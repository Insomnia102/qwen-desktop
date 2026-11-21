# Third-party components

Qwen Desktop's project license is GPL-3.0-only. It does not replace the
licenses of the third-party components distributed with this application.

The packaging process generates an inventory of the installed production
dependencies and available peer dependencies, with their versions and declared
licenses. License, copying, copyright and notice files supplied in those
packages are copied without changing their contents into `legal/third-party/`.
The generated inventory appears below this introduction in the installed copy.

Electron and its Chromium, Node.js and other components retain their own
licenses. Preserve the runtime's license and Chromium notice files supplied
alongside the application. Qwen Code SDK and its bundled CLI retain their
upstream licenses and embedded third-party notices; the SDK package is also
distributed intact. This generated inventory describes installed packages;
it is not a separate audit of every library embedded in an upstream bundle.

The `legal/SOURCE_CODE.txt` document identifies the source commit and download
links for a release built by GitHub Actions. Dependency versions and build
instructions are available in that source tree. Keep source downloads available
for as long as the corresponding binaries are distributed.

## Anthropic skill-creator

The bundled `resources/skills/skill-creator` derives from
https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/skill-creator.
It is provided under Apache-2.0; the full license is retained as `LICENSE.txt`
in that directory. Qwen Desktop supplies adapted entry instructions and a
Desktop test-suite reference. The original entry remains `UPSTREAM_SKILL.md`;
upstream evaluation helpers target Claude and are not the Desktop Qwen runner.
