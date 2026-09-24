const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { isTransientTutorialNavigationError, navigateToMountedTutorial } = require('./tutorial-navigation');

function tutorialPageFixture(mountResults, overrides = {}) {
    const gotoCalls = [];
    let selectorCalls = 0;
    let mountIndex = 0;
    const page = {
        goto: async (...args) => {
            gotoCalls.push(args);
            return { status: () => 200 };
        },
        waitForSelector: async () => {
            selectorCalls += 1;
            if (overrides.selectorError) throw overrides.selectorError;
        },
        ...overrides.page,
    };
    const mountAssertion = async () => mountResults[mountIndex++];
    return { page, mountAssertion, gotoCalls, getSelectorCalls: () => selectorCalls };
}

describe('tutorial-navigation', () => {
    it('首次路由未挂载时重新导航一次，复验仍要求语言入口可见', async () => {
        const fixture = tutorialPageFixture([
            { mounted: false, label: 'tutorial-step-one' },
            { mounted: true, label: 'tutorial-step-one' },
        ]);

        await navigateToMountedTutorial(fixture.page, 'https://example.test/tutorial?lang=zh', fixture.mountAssertion);

        assert.equal(fixture.gotoCalls.length, 2);
        assert.deepEqual(fixture.gotoCalls[0][1], { waitUntil: 'load', timeout: 60000 });
        assert.equal(fixture.getSelectorCalls(), 1);
    });

    it('连续两次未挂载仍硬失败', async () => {
        const fixture = tutorialPageFixture([
            { mounted: false, label: 'tutorial-step-one' },
            { mounted: false, label: 'tutorial-step-one' },
        ]);

        await assert.rejects(
            navigateToMountedTutorial(fixture.page, 'https://example.test/tutorial?lang=zh', fixture.mountAssertion),
            /教程页未在 30000ms 内挂载（等待 tutorial-step-one）/,
        );
        assert.equal(fixture.gotoCalls.length, 2);
        assert.equal(fixture.getSelectorCalls(), 0);
    });

    it('教程内容已挂载但语言入口缺失时不重试', async () => {
        const fixture = tutorialPageFixture([{ mounted: true, label: 'tutorial-step-one' }], {
            selectorError: new Error('missing'),
        });

        await assert.rejects(
            navigateToMountedTutorial(fixture.page, 'https://example.test/tutorial?lang=zh', fixture.mountAssertion),
            /教程页内容已挂载，但语言切换入口不可见/,
        );
        assert.equal(fixture.gotoCalls.length, 1);
        assert.equal(fixture.getSelectorCalls(), 1);
    });

    it('只复验网关暂时错误，HTTP 404 保持硬失败', async () => {
        let calls = 0;
        const page = {
            goto: async () => ({ status: () => (calls++ === 0 ? 503 : 200) }),
            waitForSelector: async () => {},
        };
        await navigateToMountedTutorial(page, 'https://example.test/tutorial', async () => ({
            mounted: true,
            label: 'tutorial-step-one',
        }));
        assert.equal(calls, 2);

        calls = 0;
        const notFoundPage = {
            goto: async () => {
                calls += 1;
                return { status: () => 404 };
            },
        };
        await assert.rejects(navigateToMountedTutorial(notFoundPage, 'https://example.test/tutorial'), /HTTP 404/);
        assert.equal(calls, 1);
    });

    it('只复验已知的 Chromium 传输错误', () => {
        assert.equal(
            isTransientTutorialNavigationError(
                new Error('page.goto: net::ERR_CONNECTION_RESET at https://example.test/tutorial'),
            ),
            true,
        );
        assert.equal(
            isTransientTutorialNavigationError(new Error('page.waitForSelector: Timeout 30000ms exceeded')),
            false,
        );
    });
});
