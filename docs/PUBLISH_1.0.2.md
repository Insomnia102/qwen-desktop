# Публикация 1.0.2

Версия в package.json уже 1.0.2. Разрабатывайте на текущей feature-ветке; сначала PR и зелёные проверки, затем тег на main. Офлайн-комплект для корпоративного Mac в репозиторий не добавляется.

## Подготовка локальной копии

Примените обновления 1.0.2 и этот пакет очистки в корень своего проекта. Удалите отслеживаемые настройки редактора (само приложение от них не зависит):

```bash
git rm -r --ignore-unmatch .vscode
node scripts/ci-check.mjs
git status --short
git diff --stat
```

Проверьте diff, затем:

```bash
git add -A
git diff --cached --stat
git commit -m "feat: add Skills Lab testing, skill creator and HTML reports"
git push -u origin HEAD
```

Если изменения уже закоммичены, повторный commit не требуется. Не добавляйте папки зависимостей, данные приложения, ключи или офлайн-архив для Mac.

## Pull request

Откройте PR из текущей ветки в main.

**Title:** `Add Skills Lab, Skill Creator and HTML test reports`

**Description:**

```markdown
Adds Skills Lab for testing skill conversations manually or with an AI user. Scenarios support natural-language requirements, evidence-linked assessments and exact checks. New suites default to YOLO, and each run uses a fresh workspace and session.

Includes the bundled Anthropic Skill Creator adapted for Qwen, improved large-package navigation, persistent run history with deletion, and standalone HTML reports. Removes shared VS Code settings from the repository.

Validation: project type checks, regression tests, build and DOM UI checks. Native installer smoke checks are completed separately before release publication.
```

Дождитесь Windows, Linux, macOS Intel и macOS Apple Silicon в CI. После успешных проверок и проверки своего Mac объедините PR. Если используете squash merge, сообщение merge-коммита может совпадать с заголовком PR.

## Релиз

Обновите локальный main и создайте новый тег:

```bash
git switch main
git pull --ff-only origin main
git tag v1.0.2
git push origin v1.0.2
```

Эта команда запускает существующий Release workflow. Он соберёт четыре платформы и создаст draft release с артефактами и контрольными суммами. Не переносите существующий тег: если v1.0.2 уже существует, сначала проверьте его назначение.

Проверьте installers по docs/RELEASING.md, затем публикуйте draft. Mac-офлайн-комплект остаётся отдельным тестовым архивом и в assets публичного релиза не добавляется.
