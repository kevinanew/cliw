const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getMountSelector, READY_SELECTORS } = require('./assert-page-mounted');

describe('assert-page-mounted', () => {
    it('READY_SELECTORS 覆盖学习页主体/封面与术语表首词条', () => {
        assert.equal(READY_SELECTORS.learningPage, '[data-testid="learning-page"]');
        assert.equal(READY_SELECTORS.learningCover, '[data-testid="learning-book-cover"]');
        assert.equal(READY_SELECTORS.glossaryFirstTerm, '[data-testid^="glossary-term-name-"]');
    });

    it('getMountSelector maps known routes to page-level test ids', () => {
        assert.deepEqual(getMountSelector('/'), {
            selector: '[data-testid="home-title"]',
            label: 'home-title',
        });
        assert.deepEqual(getMountSelector('/glossary'), {
            selector: '[data-testid="glossary-header"]',
            label: 'glossary-header',
        });
        assert.deepEqual(getMountSelector('/tutorial'), {
            selector: '[data-testid="tutorial-step-one"]',
            label: 'tutorial-step-one',
        });
        assert.deepEqual(getMountSelector('/learning'), {
            selector: '[data-testid="learning-page"]',
            label: 'learning-page',
        });
        assert.deepEqual(getMountSelector('/h5-tutorial/laiwan-life'), {
            selector: '[data-testid="h5-tutorial-url-link-0"]',
            label: 'h5-tutorial-url-link-0',
        });
    });

    it('getMountSelector maps /glossary/:locale (any) to glossary list header', () => {
        const expected = {
            selector: '[data-testid="glossary-header"]',
            label: 'glossary-header',
        };

        assert.deepEqual(getMountSelector('/glossary/zh'), expected);
        assert.deepEqual(getMountSelector('/glossary/zh-TW'), expected);
        assert.deepEqual(getMountSelector('/glossary/en'), expected);
        assert.deepEqual(getMountSelector('/glossary/fr'), expected);
    });

    it('getMountSelector recognizes glossary definition routes for any locale', () => {
        const expected = {
            selector: '[data-testid="definition-term-name"]',
            label: 'definition-term-name',
        };

        assert.deepEqual(getMountSelector('/glossary/zh/banzhahu'), expected);
        assert.deepEqual(getMountSelector('/glossary/zh-TW/banzhahu'), expected);
        assert.deepEqual(getMountSelector('/glossary/en/bluff'), expected);
        assert.deepEqual(getMountSelector('/glossary/fr/term'), expected);
    });

    it('getMountSelector falls back to home for unknown paths', () => {
        assert.deepEqual(getMountSelector('/unknown'), {
            selector: '[data-testid="home-title"]',
            label: 'home-title',
        });
    });
});
