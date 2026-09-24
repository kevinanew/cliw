module.exports = {
    async apply(page) {
        await page.addInitScript(() => {
            const id = 'visual-disable-animations';
            const css =
                '*, *::before, *::after {' +
                ' animation: none !important;' +
                ' animation-delay: 0s !important;' +
                ' transition: none !important;' +
                ' scroll-behavior: auto !important;' +
                ' }';
            const inject = () => {
                if (document.getElementById(id)) {
                    return;
                }
                const style = document.createElement('style');
                style.id = id;
                style.textContent = css;
                (document.head || document.documentElement).appendChild(style);
            };
            inject();
            document.addEventListener('DOMContentLoaded', inject);
        });
        await page.evaluate(() => {
            const id = 'visual-disable-animations';
            const css =
                '*, *::before, *::after {' +
                ' animation: none !important;' +
                ' animation-delay: 0s !important;' +
                ' transition: none !important;' +
                ' scroll-behavior: auto !important;' +
                ' }';
            if (document.getElementById(id)) {
                return;
            }
            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        });
    },
};
