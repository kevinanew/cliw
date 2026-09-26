const { expect } = require('@playwright/test');

// 有重复子控件时，先用唯一业务容器缩小范围。
function getTarget(page, target) {
    return typeof target === 'string'
        ? page.getByTestId(target)
        : page.getByTestId(target.within).getByTestId(target.testId);
}

module.exports = async (page, scenario) => {
    const inputs = scenario.keyPressTestIds || scenario.keyPressTestId;
    if (inputs) {
        for (const input of [].concat(inputs)) {
            const locator = getTarget(page, input.testId);
            await expect(locator).toHaveCount(1);
            await locator.fill(input.keyPress);
        }
    }

    for (const action of ['hover', 'focus', 'click']) {
        const targets = scenario[`${action}TestIds`] || scenario[`${action}TestId`];
        if (!targets) continue;
        for (const target of [].concat(targets)) {
            const locator = getTarget(page, target);
            await expect(locator).toHaveCount(1);
            await locator[action]();
        }
    }

    if (scenario.postInteractionHide) {
        await expect(getTarget(page, scenario.postInteractionHide)).toHaveCount(0);
    }
    if (scenario.scrollIntoViewTestId) {
        const target = getTarget(page, scenario.scrollIntoViewTestId);
        await expect(target).toHaveCount(1);
        await target.scrollIntoViewIfNeeded();
    }
    if (scenario.postInteractionWait) {
        const target = getTarget(page, scenario.postInteractionWait);
        await expect(target).toHaveCount(1);
        await expect(target).toBeInViewport();
    }
    if (scenario.scrollToTestId) {
        const target = getTarget(page, scenario.scrollToTestId);
        await expect(target).toHaveCount(1);
        await target.evaluate(async (element) => {
            // 跨两帧重新对齐，等待离屏分组回填真实高度。
            for (let frame = 0; frame < 3; frame += 1) {
                element.scrollIntoView();
                await new Promise((resolve) => requestAnimationFrame(resolve));
            }
        });
        await expect
            .poll(() =>
                target.evaluate((element) => {
                    const container = element.closest('[data-testid="glossary-page"]');
                    const offset = Number.parseFloat(
                        getComputedStyle(container).getPropertyValue('--glossary-anchor-offset'),
                    );
                    return Math.abs(element.getBoundingClientRect().top - offset);
                }),
            )
            .toBeLessThanOrEqual(1);
    }
};
