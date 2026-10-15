import { test, expect } from '@playwright/test';
import { captureHomeAnimations } from './homeEntrance';
import { frame, requireMotion, seek } from './motion';

test.beforeEach(
    /** 在真实浏览器中构造有延迟的有限动画和循环动画，验证取帧工具自身。 */ async ({ page }) => {
        await captureHomeAnimations(page);
        await page.goto('about:blank');
        await page.setContent(`
        <style>
            @keyframes movement { from { transform: translateX(0); } to { transform: translateX(100px); } }
            @keyframes pulse { from { opacity: 1; } to { opacity: .5; } }
            [data-testid="finite"] { animation: movement 1s linear 200ms both; width: 30px; height: 30px; background: red; }
            [data-testid="loop"] { animation: pulse 2s linear infinite; width: 30px; height: 30px; background: blue; }
        </style>
        <div data-testid="finite"></div><div data-testid="loop"></div>
    `);
    },
);

test('取帧保留延迟、循环周期和有限动画末帧', /** 防止统一时间轴被错误转换为各动画的独立百分比。 */ async ({ page }) => {
    const finite = await requireMotion(page, { within: 'finite' }, 1000);
    const loop = await requireMotion(page, { within: 'loop' }, 2000);
    await seek(page, [...finite, ...loop], 700);
    await expect(page.getByTestId('finite')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 50, 0)');
    await expect(page.getByTestId('loop')).toHaveCSS('opacity', '0.825');
    await seek(page, [...finite, ...loop], 3000);
    await expect(page.getByTestId('finite')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 99.9, 0)');
    await expect(page.getByTestId('loop')).toHaveCSS('opacity', '0.75');
});

test('动画消失后拒绝重新播放并生成基准', /** 确认被业务取消的动画不会被测试工具复活而掩盖缺陷。 */ async ({ page }) => {
    const ids = await requireMotion(page, { within: 'finite' }, 1000);
    await page.getByTestId('finite').evaluate(
        /** 模拟组件取消入场动画。 */ (element) => {
            (element as HTMLElement).style.animation = 'none';
        },
    );
    await expect(seek(page, ids, 100)).rejects.toThrow('所测动画已被取消或移除');
});

test('截图意外推进动画时拒绝比较图片', /** 模拟截图工具改变动画时间，确保校验先于基准接受。 */ async ({ page }) => {
    const ids = await requireMotion(page, { within: 'finite' }, 1000);
    const screenshot = page.screenshot.bind(page);
    page.screenshot = /** 截图后模拟工具将动画推进到错误的时刻。 */ async (options) => {
        const result = await screenshot(options);
        await seek(page, ids, 800);
        return result;
    };
    await expect(frame(page, '不应生成的基准', ids, 700)).rejects.toThrow('toBeCloseTo');
});
