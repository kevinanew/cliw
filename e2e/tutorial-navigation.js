const { assertPageMounted } = require('./assert-page-mounted');

const TUTORIAL_NAVIGATION_ATTEMPTS = 2;
const TUTORIAL_NAVIGATION_OPTIONS = { waitUntil: 'load', timeout: 60000 };
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

function isTransientTutorialNavigationError(error) {
    return (
        error instanceof Error &&
        /page\.goto: net::ERR_(?:TIMED_OUT|CONNECTION_CLOSED|CONNECTION_RESET)/.test(error.message)
    );
}

/**
 * 直达教程页时先断言路由内容已挂载，再断言语言入口。
 *
 * 首次的网关 502/503/504、Chromium 传输错误或整个路由未挂载可能来自
 * 部署切换期的瞬时资源不一致，允许在同一 context 中重新导航一次。若教程
 * 内容已挂载而语言入口不可见，则是确定性产品回归，不重试。
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {(page: import('playwright').Page, pathname: string, options: { timeout: number }) => Promise<{ mounted: boolean, label: string }>} [mountAssertion]
 */
async function navigateToMountedTutorial(page, url, mountAssertion = assertPageMounted) {
    let lastError;

    for (let attempt = 1; attempt <= TUTORIAL_NAVIGATION_ATTEMPTS; attempt += 1) {
        try {
            const response = await page.goto(url, TUTORIAL_NAVIGATION_OPTIONS);
            const status = response === null ? null : response.status();
            if (status !== null && status >= 400) {
                const error = new Error(`教程页导航返回 HTTP ${status}`);
                if (!TRANSIENT_HTTP_STATUSES.has(status) || attempt === TUTORIAL_NAVIGATION_ATTEMPTS) {
                    throw error;
                }
                lastError = error;
            } else {
                const { mounted, label } = await mountAssertion(page, '/tutorial', { timeout: 30000 });
                if (mounted) {
                    try {
                        await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
                    } catch (error) {
                        throw new Error('教程页内容已挂载，但语言切换入口不可见', { cause: error });
                    }
                    return;
                }
                lastError = new Error(`教程页未在 30000ms 内挂载（等待 ${label}）`);
                if (attempt === TUTORIAL_NAVIGATION_ATTEMPTS) {
                    throw lastError;
                }
            }
        } catch (error) {
            if (!isTransientTutorialNavigationError(error) || attempt === TUTORIAL_NAVIGATION_ATTEMPTS) {
                throw error;
            }
            lastError = error;
        }

        console.log(
            `   教程页首次导航未就绪，重新导航 ${attempt}/${TUTORIAL_NAVIGATION_ATTEMPTS - 1}: ${lastError.message}`,
        );
    }

    throw lastError;
}

module.exports = { isTransientTutorialNavigationError, navigateToMountedTutorial };
