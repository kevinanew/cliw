const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
    REQUIRED_GLOSSARY_PATHS,
    REQUIRED_GLOSSARY_TERM_ALTERNATES,
    buildGlossaryDefinitionPath,
    isGlossaryDefinitionUrl,
    sampleArray,
    pickGlossarySample,
} = require('./glossary-sample');

describe('glossary-sample', () => {
    /** @type {string | undefined} */
    let originalSeed;

    beforeEach(() => {
        originalSeed = process.env.GLOSSARY_SAMPLE_SEED;
    });

    afterEach(() => {
        if (originalSeed === undefined) {
            delete process.env.GLOSSARY_SAMPLE_SEED;
        } else {
            process.env.GLOSSARY_SAMPLE_SEED = originalSeed;
        }
    });

    it('isGlossaryDefinitionUrl accepts zh, zh-TW, and en glossary paths', () => {
        assert.equal(isGlossaryDefinitionUrl('https://example.com/glossary/zh/banzhahu'), true);
        assert.equal(isGlossaryDefinitionUrl('https://example.com/glossary/zh-TW/banzhahu'), true);
        assert.equal(isGlossaryDefinitionUrl('https://example.com/glossary/en/bluff'), true);
        assert.equal(isGlossaryDefinitionUrl('https://example.com/glossary'), false);
        assert.equal(isGlossaryDefinitionUrl('not-a-url'), false);
    });

    it('REQUIRED_GLOSSARY_TERM_ALTERNATES maps each locale to the required term slug', () => {
        assert.deepEqual(REQUIRED_GLOSSARY_TERM_ALTERNATES, {
            zh: 'dezhoupuke',
            'zh-TW': 'dezhoupuke',
            en: 'texasholdem',
        });
    });


    it('buildGlossaryDefinitionPath encodes term and joins locale', () => {
        assert.equal(buildGlossaryDefinitionPath('zh', 'dezhoupuke'), '/glossary/zh/dezhoupuke');
        assert.equal(buildGlossaryDefinitionPath('en', 'texasholdem'), '/glossary/en/texasholdem');
        assert.equal(buildGlossaryDefinitionPath('zh-TW', 'a/b'), `/glossary/zh-TW/${encodeURIComponent('a/b')}`);
    });

    it('sampleArray returns at most size items without mutating the original array', () => {
        const items = ['a', 'b', 'c', 'd', 'e'];
        const sampled = sampleArray(items, 2);

        assert.equal(sampled.length, 2);
        assert.equal(sampleArray(items, 10).length, 5);
        assert.equal(items.length, 5);
        sampled.forEach((item) => {
            assert.ok(items.includes(item));
        });
    });

    it('sampleArray is deterministic when GLOSSARY_SAMPLE_SEED is set', () => {
        process.env.GLOSSARY_SAMPLE_SEED = '42';
        const items = ['a', 'b', 'c', 'd', 'e'];
        const first = sampleArray(items, 3);
        const second = sampleArray(items, 3);
        assert.deepEqual(first, second);
    });

    it('sampleArray is deterministic by default when GLOSSARY_SAMPLE_SEED is unset', () => {
        delete process.env.GLOSSARY_SAMPLE_SEED;
        const items = ['a', 'b', 'c', 'd', 'e'];
        const first = sampleArray(items, 3);
        const second = sampleArray(items, 3);
        assert.deepEqual(first, second);
    });

    it('sampleArray uses Math.random when GLOSSARY_SAMPLE_SEED is empty string', () => {
        process.env.GLOSSARY_SAMPLE_SEED = '';
        const items = ['a', 'b', 'c', 'd', 'e'];
        const originalRandom = Math.random;
        // Fisher-Yates with random() === 0 always swaps with index 0 → ['b','c','d','e','a']
        Math.random = () => 0;
        try {
            assert.deepEqual(sampleArray(items, 2), ['b', 'c']);
        } finally {
            Math.random = originalRandom;
        }
    });

    it('pickGlossarySample always includes required glossary paths first', () => {
        const items = [
            '/glossary/zh/dezhoupuke',
            '/glossary/en/texasholdem',
            '/glossary/zh-TW/dezhoupuke',
            '/glossary/zh/other-term',
        ];

        const sample = pickGlossarySample(items, 10);
        const paths = sample.map((item) => new URL(`https://example.com${item}`).pathname);

        for (const requiredPath of REQUIRED_GLOSSARY_PATHS) {
            assert.ok(paths.includes(requiredPath), `missing required path ${requiredPath}`);
        }
        assert.equal(paths.indexOf('/glossary/zh/dezhoupuke'), 0);
        assert.equal(paths.indexOf('/glossary/zh-TW/dezhoupuke'), 1);
        assert.equal(paths.indexOf('/glossary/en/texasholdem'), 2);
    });

    it('pickGlossarySample enqueues missing required paths when origin is provided', () => {
        const sample = pickGlossarySample(['/about'], 3, { origin: 'https://example.com' });
        const paths = sample.map((item) => new URL(item).pathname);

        assert.deepEqual(paths, REQUIRED_GLOSSARY_PATHS);
    });
});
