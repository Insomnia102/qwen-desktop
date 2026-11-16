# Подготовка репозитория и первого релиза

## Установить это обновление

Архив содержит только изменённые и новые файлы поверх последних исправлений CLI, закрытия окна, языка и sidebar. Скопируйте его содержимое в корень проекта с заменой одноимённых файлов. Включите отображение скрытых файлов: папка `.github` обязательна.

Дополнение `qwen-package-release-fix` содержит package.json под предоставленный проект с версией **1.0.0**. Подготовительный скрипт принимает также корректный entry point `./out/main/index.js`, закрепляет вашу установленную версию pnpm и дополняет .gitignore. Lockfile создаётся/обновляется вашим `pnpm install`.

Из терминала в корне **вашего** проекта:

```bash
pnpm exec node scripts/prepare-release.mjs
pnpm install
pnpm exec node scripts/ci-check.mjs
```

Если pnpm не передал свой user-agent, выполните `pnpm --version`, затем `node scripts/prepare-release.mjs --pnpm-version X.Y.Z`, подставив **вашу точную** версию. Если подготовка уже выполнена, повторный запуск сохраняет закреплённый `packageManager`.

Скрипт:

- добавляет отсутствующие production-зависимости и переносит их из devDependencies при необходимости;
- закрепляет SDK 0.1.32 и electron-builder 26.18.0, на которые рассчитаны этот код и signing-конфигурация;
- добавляет недостающие инструменты сборки/проверки и отсутствующие scripts;
- сохраняет существующие scripts, имя автора и прочие поля;
- дополняет существующий `.gitignore` правилами из `.gitignore.release`, сохраняя ваши прежние правила;
- не запускает установку, не создаёт репозиторий и не отправляет код.

После него **обязательно** выполните `pnpm install`: GitHub использует frozen lockfile. Если в `package.json` остался `node-pty`, который больше нигде не используется, удалите его через pnpm; SDK-интерфейсу он не требуется и его Electron rebuild может мешать сборке. Не отключайте ошибку rebuild вместо исправления ненужной зависимости.

## Создать репозиторий

1. Создайте репозиторий GitHub. Для первого импорта удобно создать пустой репозиторий, без автоматически добавленного README.
2. Проверьте diff и выберите лицензию проекта. README не объявляет MIT или другую лицензию от вашего имени.
3. Убедитесь, что `package.json` имеет правильные `name` (`qwen-desktop`), `version`, `description`, `author` и точный `packageManager`.
4. Добавьте исходники, `.github/`, `build/`, `resources/`, `scripts/`, `types/`, тесты, `electron-builder.yml`, `tsconfig.ci.json`, обычные tsconfig/electron-vite-конфиги и `pnpm-lock.yaml`.
5. Не добавляйте `node_modules`, `out`, `dist`, `.env`, реальные ключи, `.qwen`, пользовательскую историю и сертификаты. Если они уже отслеживались Git, `.gitignore` не удалит их из истории.

```bash
git init
git branch -M main
git add .
git diff --cached --stat
git commit -m "Prepare Qwen Desktop for first release"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Для существующего репозитория используйте его текущую историю и remote; повторно `git init`/`remote add` не нужны. Ссылка выше — шаблон, не выдуманный опубликованный репозиторий.

## Сначала зелёный Checks

На main/master и pull requests запускаются четыре native-runner: Windows x64, Ubuntu x64, macOS Intel и macOS arm64. В каждом проверяются типы, тесты с локальным модельным API, сборка и DOM-сценарии. Настоящие API-ключи для CI не нужны. Телеметрия тестового CLI отключена.

Проверки используют production SDK из зависимостей проекта. Перезапуск инициализации, права, MCP, история и skills проверяются локальными фикстурами. Это не проверка качества ответов настоящей модели и не полная автоматизация native GUI.

Не используйте macos-14 для этих workflow: выбранные здесь актуальные runner labels — `macos-15-intel` и `macos-15`. Источник: [GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job).

## Создать draft release

Версия тега должна точно соответствовать версии `package.json`. Для текущей версии **1.0.0**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Не создавайте тег на незакоммиченных локальных изменениях. Для следующего релиза сначала обновите версию и lockfile через pnpm, закоммитьте их, затем создайте новый тег. Пример предварительной версии: `1.1.0-beta.1` → `v1.1.0-beta.1`.

Release workflow:

1. Сверяет тег и package.json.
2. На каждой ОС повторяет проверки и собирает установщик.
3. Проверяет реальный packaged executable: Electron-as-Node запускает распакованный bootstrap и bundled CLI с `--version`. Проверяются пути ASAR и версия SDK/CLI; платный API не используется.
4. Собирает установщики и checksum manifests отдельно для каждой платформы.
5. Только после успеха всех четырёх сборок сверяет все SHA-256 и создаёт **draft** с установщиками и `SHA256SUMS.txt`.

`GITHUB_TOKEN` выдаётся workflow автоматически. Отдельный PAT в secrets не нужен. Право `contents: write` есть только у publish-job. В PR используется `pull_request`, без `pull_request_target`. Код форка не получает токен публикации.

Повторный запуск может обновить артефакты ещё не опубликованного draft. Уже публичный релиз workflow не перезаписывает: выпускайте новую версию. Ручной `Run workflow` сохраняет установщики в Actions Artifacts и **не создаёт релиз**.

## Что публикуется

| Платформа | Файлы |
| --- | --- |
| Windows x64 | `qwen-desktop-X.Y.Z-win-x64.exe` |
| Linux x64 | `qwen-desktop-X.Y.Z-linux-x64.AppImage`, `.tar.gz` |
| macOS Intel | `qwen-desktop-X.Y.Z-mac-x64.dmg`, `.zip` |
| macOS Apple Silicon | `qwen-desktop-X.Y.Z-mac-arm64.dmg`, `.zip` |
| Все платформы | `SHA256SUMS.txt` |

Имя содержит ОС и архитектуру, поэтому macOS-артефакты не конфликтуют. Snap/deb и автообновление в эту первую конфигурацию не входят. Старый placeholder publish URL удалён; обновления устанавливаются вручную.

## Ручная проверка перед Publish release

Скачайте сборки из draft и проверьте на соответствующих системах:

- запуск обычным способом: Windows installer, Finder/Applications и Linux desktop;
- первый экран с установленным Node/npm и без глобального Qwen; подготовка CLI и первый запрос;
- чтение и запись тестового файла, запрос разрешения, отмена команды;
- история после перезапуска и закрытие окна без ошибки;
- ru/en/zh-CN, смена темы и раскрытие папок;
- stdio MCP с Node/Python и подключение HTTP/SSE при необходимости;
- сохранение и последующее чтение зашифрованного ключа; на Linux — доступный keyring или environment-профиль.

После этого откройте draft в Releases, отредактируйте описание и нажмите **Publish release**.

## Подписи

Первая матрица работает без купленных сертификатов. Windows не подписывается публичным сертификатом; macOS имеет ad-hoc подпись `-` и `notarize: false`. Gatekeeper/SmartScreen могут потребовать дополнительное подтверждение. Это не эквивалент Developer ID/notarization.

Для будущего подписанного macOS-релиза потребуются ваш Developer ID и notarization credentials. Уберите `identity: '-'`, настройте сертификаты через GitHub Secrets, включите notarization и пересмотрите entitlements: `disable-library-validation` добавлен именно для ad-hoc режима. Не храните сертификаты, пароли или `.p8` в репозитории. Поля этого YAML рассчитаны на electron-builder **26**; в 27 структура signing-настроек меняется.

Справка: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [electron-builder signing](https://www.electron.build/code-signing), [notarization](https://www.electron.build/notarize).

## Границы текущей проверки

В среде подготовки доступны Linux-проверки кода и локальные фикстуры. GitHub Actions ещё не запускался в вашем репозитории; macOS/Windows installer GUI здесь не подтверждён. Статус поддержки нужно повышать после реального прохождения матрицы и ручной проверки, а не только наличия настроек сборки.
