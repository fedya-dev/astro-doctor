# 🩺 Astro Doctor

> Static analysis, SEO, build and link checker for Astro projects

Astro Doctor е CLI инструмент, който обхожда Astro проекта ви, открива потенциални проблеми — счупени линкове, липсващи ресурси, SEO проблеми, leak-нати ключове, грешки в build — и генерира подробен Markdown отчет.

## 🎯 Характеристики

- ✅ **Static analysis** на всички `.md`, `.mdx`, `.astro`, `.css`, `.js`, `.ts` файлове
- ✅ **Build check** — пуска `npm run build` и улавя грешките
- ✅ **HTML проверка** на генерирания `dist/` — SEO, линкове, anchors, canonical
- ✅ **Internal link check** — намира счупени линкове към dynamic routes (`[slug].astro`, `[...page].astro`)
- ✅ **External link check** — HEAD/GET заявки към външни URL-и (с rate limiting)
- ✅ **Robots.txt & Sitemap** валидация
- ✅ **Secret token detection** — RSA keys, GitHub PAT, AWS AKIA, OpenAI sk-... и др.
- ✅ **TODO/FIXME marker** сканиране
- ✅ **Gitignore** presence check
- ✅ **Cloudflare adapter** aware — намира статичните файлове в `dist/client/`
- ✅ **JSON output** за CI/CD pipelines
- ✅ **Markdown report** с подредени находки по тежест

## 📦 Инсталация

### Опция 1: Директно изтегляне

```bash
# Клонирай репото
git clone https://github.com/fedya-dev/astro-doctor.git

# Направи скрипта execut-able
chmod +x astro-doctor/astro-doctor.mjs

# Сложи го в PATH (опционално)
sudo cp astro-doctor/astro-doctor.mjs /usr/local/bin/astro-doctor
```

### Опция 2: Каталог `~/bin/`

```bash
mkdir -p ~/bin
cp astro-doctor.mjs ~/bin/
chmod +x ~/bin/astro-doctor.mjs

# Добави ~/bin към PATH (ако не е вече) — в .bashrc / .zshrc:
# export PATH="$HOME/bin:$PATH"
```

### Опции 3: npx (бъдеще — когато публикуваме в npm)

```bash
npx astro-doctor
```

## 🚀 Използване

### Основни команди

```bash
# Отиди в папката на твоя Astro проект
cd /path/to/my-astro-project

# Пусни пълна проверка (build + статични файлове + външни линкове)
node ~/bin/astro-doctor.mjs

# Бързо тестване (без build и без външни линкове — ~5 сек)
node ~/bin/astro-doctor.mjs --no-build --no-external

# JSON изход (за CI/CD pipelines)
node ~/bin/astro-doctor.mjs --json > report.json
```

### Опции

| Опция | Какво прави |
|---|---|
| `--no-build` | Пропуска `npm run build` — използвай ако искаш само статичен анализ |
| `--no-external` | Пропуска проверката на външни линкове (HEAD/GET заявки) |
| `--json` | Изходът е JSON вместо Markdown конзолен + файл |

### Примерен изход

```
Astro Doctor v1.3.0
Project: /home/fedya/zdravemag
Node.js: v22.23.1

  Running Astro check...
  Running npm run build...

Astro Doctor summary
--------------------
CRITICAL: 0
ERROR:    0
WARNING:  3
INFO:     12
Report:   /home/fedya/zdravemag/astro-doctor-report.md
```

## 📋 Видове находки (findings)

Скриптът генерира 4 нива на тежест:

| Ниво | Описание | Exit code |
|---|---|---|
| 🔴 **CRITICAL** | Build fail, секретни ключове, счупен package.json | 1 |
| 🟠 **ERROR** | Липсващи локални ресурси, счупени вътрешни линкове | 1 |
| 🟡 **WARNING** | Липсващи SEO метаданни, счупени външни линкове, проблеми с robots.txt | 0 |
| 🔵 **INFO** | Информационни — TODO маркери, успешни проверки, наличие на sitemap | 0 |

### Пълен списък от кодове

#### Критични (CRITICAL)
- `NOT_A_NODE_PROJECT` — няма `package.json`
- `PACKAGE_JSON_INVALID` — счупен JSON
- `BUILD_FAILED` — `npm run build` върна грешка
- `POSSIBLE_SECRET_TOKEN` — открит възможен API ключ/токен

#### Грешки (ERROR)
- `LOCAL_RESOURCE_MISSING` — снимка/CSS/JS, рефериран в HTML, липсва в `dist/`
- `INTERNAL_LINK_BROKEN` — вътрешен линк към несъществуваща страница
- `SITEMAP_XML_INVALID` — невалиден sitemap.xml
- `ASTRO_CHECK_FAILED` — `astro check` върна TypeScript грешки
- `SCRIPT_*_FAILED` — npm script (check/typecheck/lint) се провали

#### Предупреждения (WARNING)
- `SEO_TITLE_MISSING` — липсва `<title>` в страницата
- `SEO_DESCRIPTION_MISSING` — липсва `<meta name="description">`
- `CANONICAL_MISSING` — липсва canonical URL
- `CANONICAL_DUPLICATE` — повече от един canonical
- `H1_MISSING` — липсва H1 заглавие
- `OPEN_GRAPH_INCOMPLETE` — липсва og:title/description/image
- `PAGE_NOINDEX` — страницата е noindex
- `FAVICON_FILE_MISSING` — деклариран favicon липсва в dist
- `LINK_URL_INVALID` — невалиден URL в HTML
- `ANCHOR_NOT_FOUND` — котва (#hash) не е намерена в целевата страница
- `DUPLICATE_TITLE` — две страници с едно и също `<title>`
- `ROBOTS_TXT_MISSING` — липсва `robots.txt` в `dist/`
- `ROBOTS_RULES_MISSING` — `robots.txt` без `User-agent:` директива
- `ROBOTS_BLOCKS_ALL` — `Disallow: /` блокира целия сайт
- `SITEMAP_MISSING` — няма sitemap XML
- `SITEMAP_LOC_MISSING` — sitemap без `<loc>` URL-и
- `SITEMAP_LOCALHOST_URL` — sitemap съдържа localhost URL
- `ROBOTS_SITEMAP_TARGET` — `Sitemap:` директивата не съвпада
- `GITIGNORE_MISSING` — няма `.gitignore`
- `BUILD_SCRIPT_MISSING` — няма `npm run build` script
- `EXTERNAL_LINK_HTTP_ERROR` — външен линк върна HTTP ≥ 400
- `EXTERNAL_LINK_LIMIT` — повече от 300 външни линка

#### Информационни (INFO)
- `ASTRO_DEPENDENCY_MISSING` — Astro не е в dependencies
- `LOCKFILE_MISSING` — няма package-lock/pnpm-lock/yarn.lock
- `ASTRO_CONFIG_MISSING` — няма `astro.config.*`
- `NODE_ENGINE_UNSET` — няма `engines.node` в package.json
- `DEPENDENCIES_NOT_INSTALLED` — няма `node_modules`
- `BUILD_SKIPPED` — `--no-build` е подаден
- `BUILD_PASS` — build мина успешно
- `ASTRO_CHECK_PASS` — `astro check` мина успешно
- `MULTIPLE_H1` — повече от едно H1 на страница (не е задължителна грешка)
- `TODO_MARKER` — файлът съдържа `TODO`/`FIXME`/`XXX`
- `CONTENT_FRONTMATTER_MISSING` — Markdown без YAML frontmatter
- `CREDENTIAL_EXAMPLE_IN_DOCS` — примерна парола в кодов блок
- `HTML_PAGES_FOUND` — намери са N HTML страници в dist
- `SITEMAP_PRESENT` — открит е sitemap с абсолютни URL-и
- `SEO_VERIFICATION_FILE_SKIPPED` — Google verification файлът е изключен
- `EXTERNAL_LINK_UNVERIFIED` — външният линк не можа да бъде потвърден (timeout/blocked)
- `EXTERNAL_LINK_RESTRICTED` — външен линк върна 401/403/429 (не е задължително счупен)
- `EXTERNAL_LINK_REDIRECT` — външен линк пренасочва

## 🐛 Известни граници

- **Външен линк лимит**: 300 URL-а (за да не бави). Можете да го увеличите ръчно в скрипта (`maxLinks`).
- **Timeout**: 10 секунди на външен линк.
- **Headless**: Няма browser automation — не може да проверява SPA-та или JS-rendered съдържание.
- **Head/GET fallback**: За сървъри, които блокират HEAD, скриптът retry-ва с GET.

## 📖 Кога да ползвате

✅ **Добри сценарии:**
- Преди commit/push — за да хванеш проблеми рано
- В CI/CD pipeline — като gate преди deploy
- След миграция на съдържание — да провериш счупени линкове
- Преди production deploy — последна проверка
- При debugging — когато сайтът "изведнъж" има проблем

❌ **Лоши сценарии:**
- Не е Lighthouse — не дава performance метрики
- Не е security scanner — намира само тривиални leaks (RSA keys, GitHub PAT)
- Не замества TypeScript компилатора — пуска `astro check`, но не е пълна замена

## 🎛️ Интеграция в CI/CD

### GitHub Actions пример

```yaml
name: Astro Doctor
on: [pull_request]

jobs:
  astro-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Run Astro Doctor
        run: node ./astro-doctor.mjs --no-external
        # Exit code 1 ако има CRITICAL/ERROR — fail-ва CI
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: astro-doctor-report
          path: astro-doctor-report.md
```

### Pre-commit hook

`.git/hooks/pre-commit`:

```bash
#!/bin/sh
node /path/to/astro-doctor.mjs --no-build --no-external
```

## 🛠️ Конфигурация

Скриптът чете автоматично от вашия Astro проект:
- `astro.config.mjs` (или `.js`, `.ts`, `.cjs`) — за `site` URL
- `package.json` — за scripts, dependencies, engines
- `public/robots.txt` — за валидация
- `src/content/` — за frontmatter проверки

Не се нуждае от отделен конфигурационен файл.

## 📊 Примерен отчет

```markdown
# Astro Doctor Report

- Version: 1.3.0
- Project: /home/fedya/my-project
- Date: 2026-10-18T16:42:00.000Z
- Node.js: v22.23.1
- Duration: 14 sec

## Summary

- CRITICAL: 0
- ERROR: 2
- WARNING: 5
- INFO: 18

## Findings

### [ERROR] LOCAL_RESOURCE_MISSING
- File: `dist/blog/foo/index.html`
- Локалният ресурс не е намерен в dist: /images/foo.webp
- Suggested action: Провери пътя, главни/малки букви и дали файлът се копира при build.

### [WARNING] EXTERNAL_LINK_HTTP_ERROR
- File: `.`
- https://example.com/old-page върна HTTP 404.
- Suggested action: Отвори адреса ръчно и провери дали страницата е преместена или премахната.
```

## 📜 Changelog

### v1.3.0 (2026-10-18)
- 🐛 Fix: Doubly-escaped regex in `isServerRoute()` — dynamic routes (`[slug].astro`, `[...page].astro`) вече се разпознават коректно (беше основен източник на false-positive `INTERNAL_LINK_BROKEN` грешки)
- 🐛 Fix: `robots.txt` и sitemap сега се търсят в `dist/client/` за Cloudflare adapter проекти (преди търсеше само в `dist/`)
- 🐛 Fix: Премахнат `Range: bytes=0-1024` header от external link check (причиняваше 416/206 false positives)
- 🐛 Fix: HTTP 206 (Partial Content) вече се приема като OK (нормализира се към 200)
- ✨ Подобрени User-Agent string (`AstroDoctor/1.3`)

### v1.2.0
- Първо публично представяне

## 🤝 Принос

1. Fork-ни репото
2. Създай feature branch (`git checkout -b feature/foo`)
3. Commit-ни промените (`git commit -am 'Add foo'`)
4. Push-ни (`git push origin feature/foo`)
5. Отвори Pull Request

## 📄 Лиценз

MIT — виж [LICENSE](LICENSE) файла.

## 👤 Автор

**Федя Серафиев**
- GitHub: [@fedya-dev](https://github.com/fedya-dev)
- Сайтове: [trainbrakes.com](https://trainbrakes.com), [zdravemag.com](https://zdravemag.com), [itpraktika.com](https://itpraktika.com)

## 🙏 Благодарности

- [Astro](https://astro.build) — за страхотния SSG, който направи този инструмент възможен
- [International Union of Railways (UIC)](https://uic.org) — за вдъхновение по железопътна метадология
- Всички, които репортват бъгове и предлагат подобрения

---

⭐ Ако този инструмент ви е полезен — star-нете репото в GitHub!
