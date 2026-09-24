/**
 * Glossary definition page sampling for E2E crawlers.
 *
 * 必测词条使用目标站点当前公开的 slug。
 * (enforced by glossary-sample.test.js).
 */

const GLOSSARY_SAMPLE_SIZE = Number(process.env.GLOSSARY_SAMPLE_SIZE) || 10;

const REQUIRED_GLOSSARY_SLUGS = [
    { locale: 'zh', term: 'dezhoupuke' },
    { locale: 'zh-TW', term: 'dezhoupuke' },
    { locale: 'en', term: 'texasholdem' },
];

const REQUIRED_GLOSSARY_PATHS = REQUIRED_GLOSSARY_SLUGS.map(({ locale, term }) => `/glossary/${locale}/${term}`);

/** locale → slug for the same required term concept (zh/zh-TW/en). */
const REQUIRED_GLOSSARY_TERM_ALTERNATES = Object.fromEntries(
    REQUIRED_GLOSSARY_SLUGS.map(({ locale, term }) => [locale, term]),
);

/**
 * @param {string} locale
 * @param {string} term
 * @returns {string}
 */
function buildGlossaryDefinitionPath(locale, term) {
    return `/glossary/${locale}/${encodeURIComponent(term)}`;
}

function isGlossaryDefinitionUrl(url) {
    try {
        const { pathname } = new URL(url);
        return /^\/glossary\/(zh|zh-TW|en)\/[^/]+$/.test(pathname);
    } catch {
        return false;
    }
}

function getPathname(urlOrPath) {
    try {
        return new URL(urlOrPath).pathname;
    } catch {
        return urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    }
}

/**
 * Mulberry32-style PRNG. Defaults to seed 42 for reproducible CI/local sampling.
 * Override with GLOSSARY_SAMPLE_SEED=<number>, or set GLOSSARY_SAMPLE_SEED= (empty) to use Math.random.
 * @returns {() => number}
 */
function createRandom() {
    const seedEnv = process.env.GLOSSARY_SAMPLE_SEED;
    if (seedEnv === '') {
        return Math.random;
    }

    let state = Number(seedEnv === undefined ? '42' : seedEnv);
    if (!Number.isFinite(state)) {
        state = 1;
    }
    state >>>= 0;

    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function sampleArray(items, size = GLOSSARY_SAMPLE_SIZE) {
    const copy = [...items];
    const random = createRandom();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(size, copy.length));
}

/**
 * Always enqueue required glossary definition paths first, then fill with random
 * (or seeded) supplemental samples up to `size`.
 *
 * @param {string[]} items Full URLs or paths already discovered
 * @param {number} [size]
 * @param {{ origin?: string }} [options] When provided, required paths missing
 *   from `items` are still enqueued as `${origin}${path}`
 * @returns {string[]}
 */
function pickGlossarySample(items, size = GLOSSARY_SAMPLE_SIZE, options = {}) {
    const { origin } = options;
    const byPath = new Map();
    for (const item of items) {
        byPath.set(getPathname(item), item);
    }

    const required = [];
    for (const path of REQUIRED_GLOSSARY_PATHS) {
        if (byPath.has(path)) {
            required.push(byPath.get(path));
        } else if (origin) {
            required.push(`${origin.replace(/\/$/, '')}${path}`);
        }
    }

    const requiredPaths = new Set(required.map(getPathname));
    const rest = items.filter((item) => !requiredPaths.has(getPathname(item)));
    const supplementalSize = Math.max(0, size - required.length);
    const supplemental = sampleArray(rest, supplementalSize);

    return [...required, ...supplemental];
}

module.exports = {
    GLOSSARY_SAMPLE_SIZE,
    REQUIRED_GLOSSARY_SLUGS,
    REQUIRED_GLOSSARY_PATHS,
    REQUIRED_GLOSSARY_TERM_ALTERNATES,
    buildGlossaryDefinitionPath,
    isGlossaryDefinitionUrl,
    sampleArray,
    pickGlossarySample,
};
