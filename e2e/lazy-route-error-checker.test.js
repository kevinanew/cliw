const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { FAIL_PATHS, navigateToMountedPage } = require('./lazy-route-error-checker');

describe('lazy-route-error-checker helpers', () => {
    it('FAIL_PATHS 覆盖 glossary 与 learning 命名 chunk', () => {
        assert.equal(FAIL_PATHS.length, 2);

        const glossary = FAIL_PATHS.find((p) => p.pathname === '/glossary');
        const learning = FAIL_PATHS.find((p) => p.pathname === '/learning');

        assert.ok(glossary);
        assert.ok(learning);
        assert.equal(glossary.navTestId, 'navbar-link-navbar_terminology_list');
        assert.equal(learning.navTestId, 'navbar-link-navbar_learning');
        assert.match(glossary.chunkGlob, /glossary/);
        assert.match(learning.chunkGlob, /learning/);
    });

    it('初始入口请求超时后重试，但仍要求页面真实挂载', async () => {
        const gotoCalls = [];
        const page = {
            goto: async (...args) => {
                gotoCalls.push(args);
                if (gotoCalls.length === 1) {
                    throw new Error('net::ERR_TIMED_OUT');
                }
            },
        };
        const mountCalls = [];
        const mountAssertion = async (...args) => {
            mountCalls.push(args);
            return { mounted: true, label: 'home-title' };
        };

        await navigateToMountedPage(page, 'https://example.test/', '/', mountAssertion);

        assert.equal(gotoCalls.length, 2);
        assert.deepEqual(gotoCalls[0][1], { waitUntil: 'commit', timeout: 60000 });
        assert.equal(mountCalls.length, 1);
        assert.deepEqual(mountCalls[0].slice(1), ['/', { timeout: 30000 }]);
    });

    it('连续两次未挂载时保持硬失败', async () => {
        const page = { goto: async () => {} };
        const mountAssertion = async () => ({ mounted: false, label: 'home-title' });

        await assert.rejects(
            navigateToMountedPage(page, 'https://example.test/', '/', mountAssertion),
            /首页未在 30000ms 内挂载（等待 home-title）/,
        );
    });
});
