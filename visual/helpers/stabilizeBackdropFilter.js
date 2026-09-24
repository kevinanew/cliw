/**
 * backdrop-filter 在 CI/Chromium 下会产生亚像素级渲染差异，导致视觉回归偶发失败。
 * 截图前禁用毛玻璃并保留已有半透明背景色，使结果可复现。
 */
module.exports = {
    async apply(page) {
        await page.evaluate(() => {
            document.querySelectorAll('*').forEach((el) => {
                const style = window.getComputedStyle(el);
                const backdrop = style.backdropFilter || style.webkitBackdropFilter;
                if (!backdrop || backdrop === 'none') {
                    return;
                }
                el.style.setProperty('backdrop-filter', 'none', 'important');
                el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            });
        });

        await page.evaluate(
            () =>
                new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                }),
        );
    },
};
