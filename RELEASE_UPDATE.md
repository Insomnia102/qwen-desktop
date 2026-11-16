# Что изменено в этом архиве

Это обновление применяется поверх последних исправлений CLI, закрытия окна, языка и sidebar. Скопируйте содержимое архива в корень проекта с заменой соответствующих файлов. Архив не содержит неизменённую часть проекта и не является standalone-репозиторием.

Добавлены публичный README, инструкция релиза, GitHub Actions Checks/Release, конфигурация четырёх сборок и вспомогательные скрипты. Для macOS/Linux исправлен поиск команд вне терминала; добавлен поиск реального npm за Node shim. Предыдущие исправления renderer и закрытия приложения сохраняются.

Важно: `src/main/index.ts` и новый `src/main/platform-env.ts` устанавливаются вместе. `electron-builder.yml` заменяет показанную ранее конфигурацию, включая placeholder publish URL и старые platform target defaults. Имя продукта `qwen-desktop` сохраняется; appId выровнен с AppUserModelID кода (`com.qwen.desktop`).

Оригинальный package.json не заменяется: выполните

```bash
pnpm exec node scripts/prepare-release.mjs
pnpm install
pnpm exec node scripts/ci-check.mjs
```

Далее следуйте `docs/RELEASING.md`. Перед git push закоммитьте обновлённые package.json, pnpm-lock.yaml и .gitignore вместе с исходниками и `.github/`. Существующие .gitignore-правила сохраняются; `.gitignore.release` — входной шаблон подготовительного скрипта.

`build/entitlements.mac.plist` предназначен для первых ad-hoc macOS-сборок без notarization. Для Developer ID его необходимо пересмотреть вместе с signing-настройками.

Проверены: строгая типизация, production build, полный набор из 92 тестов и дополнительная проверка POSIX execute permissions (итого 93 тестовых случая), два DOM-сценария UI, схема electron-builder 26, конфигурация матрицы и контрольные суммы релизных файлов. Также проверено, что одноразовая подготовка сохраняет пользовательские scripts/author и прежние правила .gitignore.

GitHub-hosted сборки и нативные установщики в этой среде ещё не запускались. Матрица и packaged smoke-test должны подтвердить их уже в вашем репозитории; draft публикуется после ручной проверки. Репозиторий, тег и публичный релиз здесь не созданы, поскольку GitHub не авторизован и URL репозитория не предоставлен.
