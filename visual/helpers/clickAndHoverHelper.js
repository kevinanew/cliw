module.exports = async (page, scenario) => {
    const hoverSelector = scenario.hoverSelectors || scenario.hoverSelector;
    const clickSelector = scenario.clickSelectors || scenario.clickSelector;
    const keyPressSelector = scenario.keyPressSelectors || scenario.keyPressSelector;
    const focusSelector = scenario.focusSelectors || scenario.focusSelector;
    const { scrollToSelector, scrollIntoViewSelector, postInteractionWait, postInteractionHide } = scenario;

    if (keyPressSelector) {
        for (const keyPressSelectorItem of [].concat(keyPressSelector)) {
            const locator = page.locator(keyPressSelectorItem.selector);
            await locator.waitFor({ state: 'visible' });
            await locator.fill(keyPressSelectorItem.keyPress);
        }
    }

    if (hoverSelector) {
        for (const hoverSelectorIndex of [].concat(hoverSelector)) {
            await page.locator(hoverSelectorIndex).hover();
        }
    }

    if (focusSelector) {
        for (const focusSelectorItem of [].concat(focusSelector)) {
            await page.locator(focusSelectorItem).focus();
        }
    }

    if (clickSelector) {
        for (const clickSelectorIndex of [].concat(clickSelector)) {
            await page.locator(clickSelectorIndex).click();
        }
    }

    // Prefer detachment/hide signals for filter-style interactions (element may already exist).
    if (postInteractionHide) {
        await page.waitForSelector(postInteractionHide, { state: 'detached' });
    }

    if (scrollIntoViewSelector) {
        await page.locator(scrollIntoViewSelector).scrollIntoViewIfNeeded();
    }

    if (postInteractionWait) {
        const timeoutMs = Number(postInteractionWait);
        // Numeric wait is a last-resort fallback; prefer selector readiness.
        if (Number.isFinite(timeoutMs) && timeoutMs > 0 && String(postInteractionWait) === String(timeoutMs)) {
            await page.waitForTimeout(timeoutMs);
        } else {
            await page.waitForSelector(postInteractionWait);
            // Scroll targets (e.g. #group-A) already exist in DOM; wait until in viewport.
            await page.waitForFunction((selector) => {
                const el = document.querySelector(selector);
                if (!el) {
                    return false;
                }
                const rect = el.getBoundingClientRect();
                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.top < window.innerHeight &&
                    rect.bottom > 0 &&
                    rect.left < window.innerWidth &&
                    rect.right > 0
                );
            }, postInteractionWait);
        }
    }

    if (scrollToSelector) {
        await page.waitForSelector(scrollToSelector);
        await page.evaluate(async (selector) => {
            const target = document.querySelector(selector);
            const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
            // content-visibility 会在首次跳转后回填真实分组高度；跨两帧重新对齐，
            // 确保截图反映稳定后的实际点击结果。
            for (let frame = 0; frame < 3; frame += 1) {
                target.scrollIntoView();
                await nextFrame();
            }
        }, scrollToSelector);
        await page.waitForFunction((selector) => {
            const target = document.querySelector(selector);
            const page = target?.closest('[class*="glossaryPage"]');
            if (!target || !page) return false;
            const anchorOffset = Number.parseFloat(getComputedStyle(page).getPropertyValue('--glossary-anchor-offset'));
            return Math.abs(target.getBoundingClientRect().top - anchorOffset) <= 1;
        }, scrollToSelector);
    }
};
