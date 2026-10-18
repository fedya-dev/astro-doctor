#!/usr/bin/env node

/**
 * Astro Doctor v1.2.0
 * Static analysis, SEO, build and link checker.
 * No automatic changes to project files.
 *
 * Usage:
 *   node ~/bin/astro-doctor.mjs
 *   node ~/bin/astro-doctor.mjs --no-build
 *   node ~/bin/astro-doctor.mjs --no-external
 *   node ~/bin/astro-doctor.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '1.3.0';
const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));
const NO_BUILD = args.has('--no-build');
const NO_EXTERNAL = args.has('--no-external');
const JSON_OUTPUT = args.has('--json');

const findings = [];
const findingKeys = new Set();
const externalURLs = new Set();
const checkedExternal = new Map();
const started = Date.now();

const ignoredDirs = new Set([
  '.git', 'node_modules', '.astro', '.wrangler',
  '.vercel', '.netlify', 'coverage'
]);

function add(level, code, file, message, fix = '') {
  const finding = {
    level,
    code,
    file: file ? path.relative(ROOT, file) || '.' : '.',
    message,
    fix
  };

  const key = JSON.stringify(finding);
  if (findingKeys.has(key)) return;

  findingKeys.add(key);
  findings.push(finding);
}

function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

// Cloudflare adapter може да поставя публичния сайт в dist/client.
function siteDist() {
  const client = path.join(DIST, 'client');
  return exists(client) ? client : DIST;
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function walk(dir, result = []) {
  if (!exists(dir)) return result;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (entry.name === 'astro-doctor-report.md') continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(full, result);
    } else if (entry.isFile()) {
      result.push(full);
    }
  }

  return result;
}

function run(command, commandArgs, timeout = 300000) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, CI: '1' }
  });

  return {
    status: result.status,
    error: result.error?.message,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  };
}

function shortOutput(value, max = 1200) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizeURLPath(value) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}

  decoded = decoded.replace(/\\/g, '/');
  if (!decoded.startsWith('/')) decoded = `/${decoded}`;
  return decoded.replace(/\/+/g, '/');
}

function htmlRoute(file) {
  let rel = path.relative(siteDist(), file).split(path.sep).join('/');

  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) {
    rel = rel.slice(0, -'index.html'.length);
    return normalizeURLPath(rel);
  }
  if (rel.endsWith('.html')) {
    return normalizeURLPath(rel.slice(0, -5));
  }

  return null;
}

function distCandidates(urlPath) {
  const clean = normalizeURLPath(urlPath).replace(/^\/+/, '');
  const candidates = [];

  if (!clean) {
    candidates.push(path.join(siteDist(), 'index.html'));
  } else {
    candidates.push(path.join(siteDist(), clean));
    candidates.push(path.join(DIST, clean, 'index.html'));

    if (!path.extname(clean)) {
      candidates.push(path.join(siteDist(), `${clean}.html`));
    }
  }

  return candidates;
}

function localTargetExists(urlPath) {
  return distCandidates(urlPath).some(file => {
    const resolved = path.resolve(file);
    return resolved.startsWith(path.resolve(siteDist()) + path.sep)
      || resolved === path.resolve(siteDist())
      ? exists(resolved) && fs.statSync(resolved).isFile()
      : false;
  });
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(
    new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
}

function allTags(html, tagName) {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? [];
}

function hasMeta(html, key, value) {
  return allTags(html, 'meta').some(tag =>
    attr(tag, key).toLowerCase() === value.toLowerCase()
  );
}

function getSiteURL(configText) {
  const match = configText.match(/\bsite\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/);
  if (!match) return null;

  try {
    return new URL(match[1]);
  } catch {
    return null;
  }
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function fileFromURL(urlPath) {
  for (const candidate of distCandidates(urlPath)) {
    if (exists(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function extractLinks(html) {
  const links = [];

  for (const tag of allTags(html, 'a')) {
    const href = attr(tag, 'href');
    if (href) links.push({ value: href, kind: 'link' });
  }

  for (const tagName of ['img', 'script', 'source', 'video', 'audio', 'iframe']) {
    for (const tag of allTags(html, tagName)) {
      const src = attr(tag, 'src');
      if (src) links.push({ value: src, kind: 'resource' });
    }
  }

  for (const tag of allTags(html, 'link')) {
    const href = attr(tag, 'href');
    const rel = attr(tag, 'rel').toLowerCase();

    if (href && /stylesheet|icon|manifest|preload|modulepreload/.test(rel)) {
      links.push({ value: href, kind: 'resource' });
    }
  }

  return links;
}

function findAnchorIds(html) {
  const ids = new Set();

  for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    ids.add(match[1]);
  }
  for (const match of html.matchAll(/\bname\s*=\s*["']([^"']+)["']/gi)) {
    ids.add(match[1]);
  }

  return ids;
}

function checkProjectBasics() {
  const pkgPath = path.join(ROOT, 'package.json');

  if (!exists(pkgPath)) {
    add('CRITICAL', 'NOT_A_NODE_PROJECT', pkgPath,
      'Липсва package.json в текущата директория.',
      'Стартирай скрипта от корена на Astro проекта.');
    return null;
  }

  let pkg;
  try {
    pkg = JSON.parse(read(pkgPath));
  } catch (error) {
    add('CRITICAL', 'PACKAGE_JSON_INVALID', pkgPath,
      `package.json не е валиден JSON: ${error.message}`,
      'Поправи синтаксиса на package.json.');
    return null;
  }

  if (!pkg.dependencies?.astro && !pkg.devDependencies?.astro) {
    add('WARNING', 'ASTRO_DEPENDENCY_MISSING', pkgPath,
      'Astro не е деклариран в dependencies или devDependencies.',
      'Провери дали това е коренът на Astro проекта.');
  }

  if (!exists(path.join(ROOT, 'package-lock.json')) &&
      !exists(path.join(ROOT, 'pnpm-lock.yaml')) &&
      !exists(path.join(ROOT, 'yarn.lock')) &&
      !exists(path.join(ROOT, 'bun.lockb')) &&
      !exists(path.join(ROOT, 'bun.lock'))) {
    add('WARNING', 'LOCKFILE_MISSING', pkgPath,
      'Не е намерен lock файл за пакетния мениджър.',
      'Използвай един пакетен мениджър и съхранявай неговия lock файл.');
  }

  const configFiles = [
    'astro.config.mjs', 'astro.config.js',
    'astro.config.ts', 'astro.config.cjs'
  ];
  const configPath = configFiles
    .map(name => path.join(ROOT, name))
    .find(exists);

  if (!configPath) {
    add('WARNING', 'ASTRO_CONFIG_MISSING', ROOT,
      'Не е намерен стандартен astro.config файл.',
      'Провери структурата на проекта и името на конфигурацията.');
  }

  if (!pkg.engines?.node) {
    add('INFO', 'NODE_ENGINE_UNSET', pkgPath,
      'package.json не задава engines.node.',
      'Обмисли ограничение за поддържаната версия на Node.js.');
  }

  return { pkg, configPath };
}

function runProjectChecks(pkg) {
  const scripts = pkg.scripts ?? {};
  const standardChecks = ['check', 'typecheck', 'lint'];

  if (!exists(path.join(ROOT, 'node_modules'))) {
    add('INFO', 'DEPENDENCIES_NOT_INSTALLED', ROOT,
      'Липсва node_modules; npm проверките и build няма да се изпълнят.',
      'Изпълни npm ci (или командата за твоя пакетен мениджър).');
    return;
  }

  for (const name of standardChecks) {
    if (!scripts[name]) continue;

    console.log(`  Running npm run ${name}...`);
    const result = run('npm', ['run', name]);

    if (result.status !== 0) {
      add('ERROR', `SCRIPT_${name.toUpperCase()}_FAILED`, ROOT,
        `npm run ${name} завърши неуспешно. ${shortOutput(result.output)}`,
        `Поправи грешките от npm run ${name}.`);
    } else {
      add('INFO', `SCRIPT_${name.toUpperCase()}_PASS`, ROOT,
        `npm run ${name} завърши успешно.`);
    }
  }

  if (!scripts.check && !scripts.typecheck) {
    const checkBin = path.join(ROOT, 'node_modules', '.bin', 'astro');

    if (exists(checkBin)) {
      const hasCheckPackage =
        pkg.devDependencies?.['@astrojs/check'] ||
        pkg.dependencies?.['@astrojs/check'];

      if (hasCheckPackage) {
        console.log('  Running Astro check...');
        const result = run(checkBin, ['check']);

        if (result.status !== 0) {
          add('ERROR', 'ASTRO_CHECK_FAILED', ROOT,
            `astro check завърши неуспешно. ${shortOutput(result.output)}`,
            'Поправи диагностицираните грешки в Astro/TypeScript.');
        } else {
          add('INFO', 'ASTRO_CHECK_PASS', ROOT,
            'astro check завърши успешно.');
        }
      } else {
        add('INFO', 'ASTRO_CHECK_NOT_CONFIGURED', ROOT,
          'Не е конфигуриран отделен astro check скрипт.',
          'При нужда добави @astrojs/check и TypeScript според документацията на Astro.');
      }
    }
  }

  if (NO_BUILD) {
    add('INFO', 'BUILD_SKIPPED', ROOT,
      'Build е пропуснат поради --no-build.');
    return;
  }

  if (!scripts.build) {
    add('WARNING', 'BUILD_SCRIPT_MISSING', ROOT,
      'В package.json няма npm run build.');
    return;
  }

  console.log('  Running npm run build...');
  const result = run('npm', ['run', 'build']);

  if (result.status !== 0) {
    add('CRITICAL', 'BUILD_FAILED', ROOT,
      `npm run build завърши неуспешно. ${shortOutput(result.output, 2500)}`,
      'Поправи build грешките преди публикуване.');
  } else {
    add('INFO', 'BUILD_PASS', ROOT, 'npm run build завърши успешно.');
  }
}

function checkRobotsAndSitemap() {
  if (!exists(DIST)) {
    add('INFO', 'DIST_NOT_AVAILABLE', ROOT,
      'Няма dist директория за проверка на генерирания сайт.',
      'Изпълни build без --no-build.');
    return;
  }

  // 🔧 Cloudflare adapter със server mode слага статичните файлове в dist/client/
  // siteDist() вече връща правилната папка — ползваме я и за robots.txt и за sitemap
  const distBase = siteDist();
  const files = walk(distBase);
  const robots = path.join(distBase, 'robots.txt');

  if (!exists(robots)) {
    const publicRobots = path.join(ROOT, 'public', 'robots.txt');

    add('WARNING', 'ROBOTS_TXT_MISSING', robots,
      'Не е намерен robots.txt в крайния dist.',
      exists(publicRobots)
        ? 'Файлът е в public/, но не е попаднал в dist. Провери build процеса.'
        : 'Създай public/robots.txt или настрой подходящ генератор.');
  } else {
    const text = read(robots);

    if (!/^\s*User-agent\s*:/im.test(text)) {
      add('WARNING', 'ROBOTS_RULES_MISSING', robots,
        'robots.txt не съдържа User-agent директива.',
        'Провери дали файлът е валиден robots.txt.');
    }

    if (/^\s*Disallow\s*:\s*\/\s*$/im.test(text)) {
      add('WARNING', 'ROBOTS_BLOCKS_ALL', robots,
        'robots.txt съдържа Disallow: / и може да блокира целия сайт.',
        'Увери се, че блокирането е умишлено.');
    }
  }

  const sitemapFiles = files.filter(file =>
    /(?:^|[/\\])sitemap[^/\\]*\.xml$/i.test(file)
  );

  if (sitemapFiles.length === 0) {
    add('WARNING', 'SITEMAP_MISSING', DIST,
      'Не е намерен sitemap XML файл в крайния dist.',
      'Провери Astro sitemap интеграцията и действителния URL на sitemap.');
  } else {
    for (const file of sitemapFiles) {
      const xml = read(file);

      if (!/<(?:\w+:)?urlset\b|<(?:\w+:)?sitemapindex\b/i.test(xml)) {
        add('ERROR', 'SITEMAP_XML_INVALID', file,
          'Файлът няма очаквания коренов елемент urlset или sitemapindex.',
          'Провери съдържанието и XML генератора.');
        continue;
      }

      if (!/<(?:\w+:)?loc>/i.test(xml)) {
        add('WARNING', 'SITEMAP_LOC_MISSING', file,
          'Sitemap не съдържа loc адреси.',
          'Провери дали генераторът включва URL адреси.');
      }

      if (/<loc>\s*https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(xml)) {
        add('WARNING', 'SITEMAP_LOCALHOST_URL', file,
          'Sitemap съдържа localhost адрес.',
          'Провери site URL в astro.config.');
      }

      if (/<loc>\s*https?:\/\/[^<\s]+/i.test(xml)) {
        add('INFO', 'SITEMAP_PRESENT', file,
          'Открит е sitemap с абсолютни URL адреси.');
      }
    }
  }

  if (exists(robots)) {
    const robotsText = read(robots);
    const sitemapDirective = robotsText.match(/^\s*Sitemap\s*:\s*(\S+)/im);

    if (sitemapDirective) {
      try {
        const sitemapURL = new URL(sitemapDirective[1]);
        const sameHostSitemap = sitemapFiles.some(file => {
          const rel = path.relative(siteDist(), file).split(path.sep).join('/');
          const expectedPath = `/${rel}`;
          return sitemapURL.pathname === expectedPath;
        });

        if (!sameHostSitemap) {
          add('WARNING', 'ROBOTS_SITEMAP_TARGET', robots,
            'Sitemap директивата не сочи към открит sitemap.',
            'Провери URL адреса в директивата Sitemap:.');
        }
      } catch {
        add('WARNING', 'ROBOTS_SITEMAP_URL_INVALID', robots,
          'Sitemap директивата съдържа невалиден URL.',
          'Задай абсолютен URL към действителния sitemap.');
      }
    } else {
      add('INFO', 'ROBOTS_SITEMAP_UNDECLARED', robots,
        'В robots.txt няма Sitemap директива.',
        'Обмисли добавяне на абсолютния URL на sitemap.');
    }
  }
}

function isServerRoute(pathname) {
  const pagesDir = path.join(ROOT, 'src', 'pages');
  const normalized = normalizeURLPath(pathname).replace(/^\/+|\/+$/g, '');
  const segments = normalized ? normalized.split('/') : [];
  const extensions = ['.astro', '.md', '.mdx'];

  let current = pagesDir;
  for (const segment of segments) current = path.join(current, segment);

  const candidates = [
    ...extensions.map(ext => current + ext),
    ...extensions.map(ext => path.join(current, 'index' + ext)),
  ];

  if (candidates.some(exists)) return true;

  // Match Astro dynamic routes such as [slug].astro and [...slug].astro.
  function hasDynamicRoute(dir, remaining) {
    if (!exists(dir) || !remaining.length) return false;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    const [segment, ...rest] = remaining;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 🔧 Оправен regex: \[ (lit. '['), не \\[ (lit. '\')
      if (/^\[\.\.\.[^/]+\]$/.test(entry.name)) return true;
      if (/^\[[^/]+\]$/.test(entry.name) &&
          hasDynamicRoute(path.join(dir, entry.name), rest)) return true;
      if (entry.name === segment &&
          hasDynamicRoute(path.join(dir, entry.name), rest)) return true;
    }

    if (rest.length === 0) {
      return entries.some(entry =>
        // 🔧 Оправен regex: \[ ... \] вместо \\[ ... \\]
        entry.isFile() && /^(?:\[\.\.\.[^/]+\]|\[[^/]+\])\.(?:astro|md|mdx)$/.test(entry.name)
      );
    }

    return false;
  }

  return hasDynamicRoute(pagesDir, segments);
}

function checkHTML() {
  if (!exists(DIST)) return;

  const htmlFiles = walk(siteDist()).filter(file => file.endsWith('.html'));
  const titleMap = new Map();
  const routeMap = new Map();
  const htmlByRoute = new Map();

  for (const file of htmlFiles) {
    const route = htmlRoute(file);
    if (route) {
      routeMap.set(route.replace(/\/+$/, '') || '/', file);
      htmlByRoute.set(route.replace(/\/+$/, '') || '/', file);
    }
  }

  const routeFor = pathname => {
    const normalized = normalizeURLPath(pathname).replace(/\/+$/, '') || '/';
    return routeMap.get(normalized) ?? null;
  };

  for (const file of htmlFiles) {
    const html = read(file);
    const rel = path.relative(siteDist(), file);
    // Google Search Console verification files are not content pages.
    if (/^google[a-f0-9]+\.html$/i.test(path.basename(file))) {
      add('INFO', 'SEO_VERIFICATION_FILE_SKIPPED', file,
        'Google verification файлът е изключен от SEO проверките.');
      continue;
    }

    const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';
    const descriptions = allTags(html, 'meta').filter(tag =>
      attr(tag, 'name').toLowerCase() === 'description'
    );
    const canonicalTags = allTags(html, 'link').filter(tag =>
      attr(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical')
    );
    const h1Count = allTags(html, 'h1').length;

    if (!title) {
      add('WARNING', 'SEO_TITLE_MISSING', file,
        'Страницата няма title или заглавието е празно.',
        'Добави уникален и смислен title.');
    } else {
      const key = title.toLowerCase();
      if (!titleMap.has(key)) titleMap.set(key, []);
      titleMap.get(key).push(file);
    }

    if (descriptions.length === 0 || !attr(descriptions[0], 'content')) {
      add('WARNING', 'SEO_DESCRIPTION_MISSING', file,
        'Липсва meta description или съдържанието му е празно.',
        'Добави кратко, уникално описание на страницата.');
    }

    if (canonicalTags.length === 0) {
      add('WARNING', 'CANONICAL_MISSING', file,
        'Не е намерен canonical линк.',
        'Провери дали layout-ът генерира canonical URL.');
    } else if (canonicalTags.length > 1) {
      add('WARNING', 'CANONICAL_DUPLICATE', file,
        `Намерени са ${canonicalTags.length} canonical линка.`,
        'Остави един правилен canonical URL.');
    }

    if (h1Count === 0) {
      add('WARNING', 'H1_MISSING', file,
        'Страницата няма H1 заглавие.',
        'Добави едно ясно основно заглавие.');
    } else if (h1Count > 1) {
      add('INFO', 'MULTIPLE_H1', file,
        `Открити са ${h1Count} H1 елемента.`,
        'Провери структурата; повече от едно H1 не е автоматично SEO грешка.');
    }

    const hasOGTitle = hasMeta(html, 'property', 'og:title');
    const hasOGDescription = hasMeta(html, 'property', 'og:description');
    const hasOGImage = hasMeta(html, 'property', 'og:image');

    if (!hasOGTitle || !hasOGDescription || !hasOGImage) {
      add('INFO', 'OPEN_GRAPH_INCOMPLETE', file,
        'Липсва една или повече от og:title, og:description и og:image.',
        'Добави Open Graph метаданни, ако страниците се споделят в социални мрежи.');
    }

    if (/\bname\s*=\s*["']robots["'][^>]*\bcontent\s*=\s*["'][^"']*\bnoindex\b/i.test(html) ||
        /\bcontent\s*=\s*["'][^"']*\bnoindex\b[^"']*["'][^>]*\bname\s*=\s*["']robots["']/i.test(html)) {
      add('WARNING', 'PAGE_NOINDEX', file,
        'Страницата съдържа robots noindex.',
        'Провери дали страницата умишлено трябва да е изключена от индексиране.');
    }

    const iconLinks = allTags(html, 'link').filter(tag =>
      /icon/i.test(attr(tag, 'rel'))
    );

    for (const tag of iconLinks) {
      const href = attr(tag, 'href');
      if (!href || /^(?:https?:)?\/\//i.test(href) || /^(?:data:|#)/i.test(href)) continue;

      try {
        const pageRoute = htmlRoute(file) ?? '/';
        const base = new URL(pageRoute, 'https://astro-doctor.invalid');
        const target = new URL(href, base);
        if (target.origin === 'https://astro-doctor.invalid' &&
            !localTargetExists(target.pathname)) {
          add('WARNING', 'FAVICON_FILE_MISSING', file,
            `Декларираният favicon не е намерен в dist: ${href}`,
            'Провери пътя до favicon и дали ресурсът се копира при build.');
        }
      } catch {}
    }

    for (const item of extractLinks(html)) {
      const raw = item.value.trim();

      // Ignore dynamic JavaScript fragments, not real URLs.
      if (
        /\$\{/.test(raw) ||
        /`/.test(raw) ||
        /\+\s*[a-zA-Z_$][\w$]*\s*\+/.test(raw)
      ) {
        continue;
      }

      if (!raw || /^(?:#|mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) continue;

      let target;
      try {
        const pageRoute = htmlRoute(file) ?? '/';
        target = new URL(raw, new URL(pageRoute, 'https://astro-doctor.invalid'));
      } catch {
        add('WARNING', 'LINK_URL_INVALID', file,
          `Невалиден URL в HTML: ${raw}`,
          'Провери синтаксиса на href/src.');
        continue;
      }

      if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;

      if (target.origin !== 'https://astro-doctor.invalid') {
        if (!NO_EXTERNAL) externalURLs.add(target.href);
        continue;
      }

      const pathname = normalizeURLPath(target.pathname);

      if (item.kind === 'resource' || path.extname(pathname)) {
        if (!localTargetExists(pathname)) {
          add('ERROR', 'LOCAL_RESOURCE_MISSING', file,
            `Локалният ресурс не е намерен в dist: ${pathname}`,
            'Провери пътя, главни/малки букви и дали файлът се копира при build.');
        }
      } else {
        const targetFile = routeFor(pathname);

        if (!targetFile && !isServerRoute(pathname)) {
          add('ERROR', 'INTERNAL_LINK_BROKEN', file,
            `Вътрешният линк няма съответстваща генерирана страница: ${pathname}`,
            'Провери маршрута, trailingSlash настройката и дали страницата се генерира.');
        } else if (target.hash) {
          const targetHTML = read(targetFile);
          const ids = findAnchorIds(targetHTML);
          let hash = target.hash.slice(1);

          try { hash = decodeURIComponent(hash); } catch {}

          if (hash && !ids.has(hash)) {
            add('WARNING', 'ANCHOR_NOT_FOUND', file,
              `Котвата #${hash} не е намерена в ${pathname}.`,
              'Провери id на заглавието или линка към секцията.');
          }
        }
      }
    }
  }

  for (const [title, files] of titleMap.entries()) {
    if (files.length > 1) {
      for (const file of files) {
        add('WARNING', 'DUPLICATE_TITLE', file,
          `Заглавието се повтаря на ${files.length} страници: "${title}"`,
          'Направи title уникален за всяка страница.');
      }
    }
  }

  if (htmlFiles.length === 0) {
    add('WARNING', 'NO_HTML_OUTPUT', DIST,
      'Не са намерени HTML страници в dist.',
      'Провери build конфигурацията и output режима.');
  } else {
    add('INFO', 'HTML_PAGES_FOUND', DIST,
      `Намерени са ${htmlFiles.length} генерирани HTML страници.`);
  }
}

function checkSourceFiles() {
  const files = walk(ROOT).filter(file =>
    /\.(?:md|mdx|astro|html|css|js|mjs|ts|json|yml|yaml|toml)$/i.test(file) &&
    !file.startsWith(DIST + path.sep)
  );

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const content = read(file);

    // Strong token patterns remain serious even inside documentation.
    const strongSecretPatterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /\bgh[pousr]_[A-Za-z0-9_]{25,}\b/,
      /\bgithub_pat_[A-Za-z0-9_]{25,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bsk-[A-Za-z0-9_-]{25,}\b/
    ];

    for (const pattern of strongSecretPatterns) {
      const match = pattern.exec(content);
      if (match) {
        const line = content.slice(0, match.index).split('\n').length;
        add('CRITICAL', 'POSSIBLE_SECRET_TOKEN', file,
          `Възможен ключ или токен на ред ${line}; стойността е скрита от отчета.`,
          'Провери стойността. Ако е реална, отмени/завърти я и я премести в secret storage.');
        break;
      }
    }

    if (/\b(?:TODO|FIXME|XXX)\b/i.test(content)) {
      add('INFO', 'TODO_MARKER', file,
        'Файлът съдържа TODO/FIXME/XXX маркер.',
        'Провери дали задачата е все още актуална.');
    }

    if (/src\/content\//.test(rel) && /\.(?:md|mdx)$/i.test(rel)) {
      // Allow a UTF-8 BOM and blank lines before the opening delimiter.
      const normalized = content.replace(/^\uFEFF/, '');
      const hasFrontmatter = /^\s*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.test(normalized);

      if (!hasFrontmatter) {
        add('INFO', 'CONTENT_FRONTMATTER_MISSING', file,
          'Не е открит YAML frontmatter в началото на Markdown файла.',
          'Провери schema изискванията на Content Collections; празните редове преди --- са допустими.');
      }
    }

    // Password examples in Markdown code blocks are not automatically secrets.
    if (/\.(?:md|mdx)$/i.test(rel)) {
      const fencedBlocks = content.match(/```[\s\S]*?```/g) ?? [];

      for (const block of fencedBlocks) {
        if (/\b(?:password|passwd|secret)\s*=\s*["'][^"']{8,}["']/i.test(block)) {
          add('INFO', 'CREDENTIAL_EXAMPLE_IN_DOCS', file,
            'В кодов блок има примерна стойност за password/secret; провери да не е реална.',
            'Използвай очевиден пример като CHANGE_ME и никога не публикувай действащи пароли.');
          break;
        }
      }
    }
  }

  const gitignore = path.join(ROOT, '.gitignore');
  if (!exists(gitignore)) {
    add('WARNING', 'GITIGNORE_MISSING', gitignore,
      'Липсва .gitignore.',
      'Добави node_modules, dist, .astro и локални секретни файлове според проекта.');
  } else {
    const text = read(gitignore);
    for (const entry of ['node_modules', 'dist']) {
      if (!text.includes(entry)) {
        add('INFO', 'GITIGNORE_ENTRY_MISSING', gitignore,
          `.gitignore може да не изключва ${entry}.`,
          `Провери дали ${entry} трябва да се игнорира в този проект.`);
      }
    }
  }
}

async function checkExternalLinks() {
  if (NO_EXTERNAL || externalURLs.size === 0) return;

  const urls = [...externalURLs];
  const maxLinks = 300;

  if (urls.length > maxLinks) {
    add('WARNING', 'EXTERNAL_LINK_LIMIT', ROOT,
      `Намерени са ${urls.length} външни URL адреса; проверяват се първите ${maxLinks}.`,
      'Пусни отделна проверка или увеличи лимита в скрипта.');
  }

  const queue = urls.slice(0, maxLinks);
  let cursor = 0;

  async function checkOne(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      checkedExternal.set(urlString, { status: 'INVALID', detail: 'Невалиден URL' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      let response;

      try {
        response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': 'AstroDoctor/1.2 link checker' }
        });

        if ([403, 404, 405, 501].includes(response.status)) {
          response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
              'User-Agent': 'AstroDoctor/1.3 link checker'
              // 🔧 Премахнат Range: bytes=0-1024 — някои сървъри връщат 416/206
            }
          });
        }
      } catch (error) {
        // HEAD may be blocked; retry once with GET.
        response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AstroDoctor/1.3 link checker'
            // 🔧 Премахнат Range — същата причина
          }
        });
      }

      const status = response.status;
      const finalURL = response.url || urlString;

      // 🔧 206 (Partial Content) е OK — значи сървърът е върнал част от съдържанието
      // (станало заради стари Range headers или тактика на сървъра). Страницата съществува.
      if ((status >= 200 && status < 400) || status === 206) {
        checkedExternal.set(urlString, {
          status: status === 206 ? 200 : status,  // нормализираме към 200 в репорта
          finalURL,
          detail: finalURL !== urlString ? `redirect → ${finalURL}` : ''
        });
      } else if (status === 401 || status === 403 || status === 429) {
        checkedExternal.set(urlString, {
          status,
          finalURL,
          detail: 'Достъпът е ограничен; това не доказва, че линкът е счупен.'
        });
      } else {
        checkedExternal.set(urlString, {
          status,
          finalURL,
          detail: `HTTP ${status}`
        });
      }
    } catch (error) {
      checkedExternal.set(urlString, {
        status: 'UNVERIFIED',
        detail: error.name === 'AbortError'
          ? 'Timeout след 10 секунди'
          : shortOutput(error.message, 180)
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function worker() {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      await checkOne(url);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, () => worker())
  );

  for (const [url, result] of checkedExternal.entries()) {
    if (typeof result.status === 'number' && result.status >= 400 &&
        ![401, 403, 429].includes(result.status)) {
      add('WARNING', 'EXTERNAL_LINK_HTTP_ERROR', ROOT,
        `${url} върна HTTP ${result.status}.`,
        'Отвори адреса ръчно и провери дали страницата е преместена или премахната.');
    } else if (result.status === 'UNVERIFIED' || result.status === 'INVALID') {
      add('INFO', 'EXTERNAL_LINK_UNVERIFIED', ROOT,
        `${url} не можа да бъде потвърден: ${result.detail}`,
        'Провери ръчно; DNS, TLS, timeout или защита от ботове може да блокират теста.');
    } else if ([401, 403, 429].includes(result.status)) {
      add('INFO', 'EXTERNAL_LINK_RESTRICTED', ROOT,
        `${url} върна HTTP ${result.status}; статусът не доказва счупен линк.`,
        'Провери ръчно, ако линкът е важен.');
    } else if (result.detail?.startsWith('redirect')) {
      add('INFO', 'EXTERNAL_LINK_REDIRECT', ROOT,
        `${url} пренасочва към ${result.finalURL}.`,
        'Провери дали пренасочването е очаквано.');
    }
  }
}

function writeReport() {
  const counts = { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 };
  for (const item of findings) counts[item.level]++;

  const lines = [
    '# Astro Doctor Report',
    '',
    `- Version: ${VERSION}`,
    `- Project: ${ROOT}`,
    `- Date: ${new Date().toISOString()}`,
    `- Node.js: ${process.version}`,
    `- Duration: ${Math.round((Date.now() - started) / 1000)} sec`,
    '',
    '## Summary',
    '',
    `- CRITICAL: ${counts.CRITICAL}`,
    `- ERROR: ${counts.ERROR}`,
    `- WARNING: ${counts.WARNING}`,
    `- INFO: ${counts.INFO}`,
    '',
    '## Findings',
    ''
  ];

  const order = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3 };
  findings.sort((a, b) =>
    order[a.level] - order[b.level] ||
    a.code.localeCompare(b.code) ||
    a.file.localeCompare(b.file)
  );

  if (findings.length === 0) {
    lines.push('Няма открити проблеми от проверките в тази версия.');
  } else {
    for (const item of findings) {
      lines.push(`### [${item.level}] ${item.code}`);
      lines.push(`- File: \`${item.file}\``);
      lines.push(`- ${item.message}`);
      if (item.fix) lines.push(`- Suggested action: ${item.fix}`);
      lines.push('');
    }
  }

  const reportPath = path.join(ROOT, 'astro-doctor-report.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      version: VERSION,
      project: ROOT,
      counts,
      findings
    }, null, 2));
  } else {
    console.log('\nAstro Doctor summary');
    console.log('--------------------');
    console.log(`CRITICAL: ${counts.CRITICAL}`);
    console.log(`ERROR:    ${counts.ERROR}`);
    console.log(`WARNING:  ${counts.WARNING}`);
    console.log(`INFO:     ${counts.INFO}`);
    console.log(`Report:   ${reportPath}`);
  }
}

async function main() {
  if (!JSON_OUTPUT) {
    console.log(`Astro Doctor v${VERSION}`);
    console.log(`Project: ${ROOT}`);
    console.log(`Node.js: ${process.version}\n`);
  }

  const project = checkProjectBasics();

  if (project) {
    runProjectChecks(project.pkg);
    checkSourceFiles();
    checkRobotsAndSitemap();
    checkHTML();
    await checkExternalLinks();
  }

  writeReport();

  const hasFailures = findings.some(item =>
    item.level === 'CRITICAL' || item.level === 'ERROR'
  );

  if (hasFailures) process.exitCode = 1;
}

main().catch(error => {
  console.error('Astro Doctor failed:', error);
  process.exitCode = 2;
});
