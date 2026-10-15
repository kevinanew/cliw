import { expect, type Locator, type Page } from '@playwright/test';
import { captureHomeAnimations, prepareHomeAssets } from './homeEntrance';

const frozenClocks = new WeakSet<Page>();

/**
 * 暂停组件卸载计时器，以便观察短暂的抽屉退出过程。
 * @param page - 已完成资源加载的测试页面
 */
export async function freezeClock(page: Page) {
    await page.clock.install({ time: new Date('2026-10-15T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-15T00:01:00Z'));
    frozenClocks.add(page);
}

export interface MotionQuery {
    name?: string;
    property?: string;
    within?: string;
    duration?: number;
    keyframeProperty?: string;
}

/**
 * 安装真实动画捕获器，固定语言和下载数据，保留生产动效。
 * @param page - 尚未导航的测试页面
 * @param locale - 网站语言代码
 * @param baseURL - 已部署站点的根地址
 */
export async function prepareMotion(page: Page, locale: string, baseURL: string) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.context().addCookies([{ name: 'language', value: locale, url: baseURL }]);
    await captureHomeAnimations(page);
    await page.route(
        '**/apk/index.json',
        /** 固定版本文字，避免新发布影响截图。 */ (route) =>
            route.fulfill({
                json: { apk_files: ['顶级玩家-2.0.2308151624.apk', '顶级玩家-2.0.2308151249.apk'] },
            }),
    );
}

/**
 * 等待样式变更并捕获新动画；暂停时钟的场景只处理必要任务。
 * @param page - 当前测试页面
 */
export async function paint(page: Page) {
    if (frozenClocks.has(page)) {
        // 只执行待提交的零延迟任务，不推进到 NProgress 随机增量或 MUI 卸载计时器。
        await page.clock.runFor(1);
        await page.evaluate(
            /** 时钟暂停时主动刷新样式并补录新动画。 */ () => {
                for (const animation of document.getAnimations()) {
                    if (window.homeEntranceCapture.has(animation)) continue;
                    window.homeEntranceCapture.set(animation, { animation, initialPlayState: animation.playState });
                    animation.pause();
                    animation.currentTime = 0;
                }
            },
        );
        return;
    }
    await page.evaluate(
        /** 等待浏览器提交动画样式。 */ () =>
            new Promise<void>(
                /** 将完成通知推迟到下一次绘制之后。 */ (resolve) =>
                    requestAnimationFrame(
                        /** 再等待一帧以完成合成。 */ () =>
                            requestAnimationFrame(/** 通知绘制完成。 */ () => resolve()),
                    ),
            ),
    );
}

/**
 * 等待当前视口图片与字体，保持动画暂停，避免字体替换造成假差异。
 * @param page - 当前测试页面
 * @param excludedImages - 请求闸门正在阻塞的图片业务标识
 */
export async function readyAssets(page: Page, excludedImages: string[] = []) {
    await page.evaluate(
        /** 解码可见图片并主动加载自托管字体。 */ async (excluded) => {
            await Promise.all([
                ...['400', '700'].flatMap(
                    /** 加载两种字体的指定字重。 */ (weight) => [
                        document.fonts.load(`${weight} 16px Inter`),
                        document.fonts.load(`${weight} 16px "Noto Sans SC"`),
                    ],
                ),
                ...Array.from(document.images)
                    .filter(
                        /** 只等待有资源且进入视口、未被测试闸门拦截的图片。 */ (image) =>
                            image.currentSrc &&
                            image.getBoundingClientRect().top < innerHeight &&
                            !excluded.includes(image.dataset.testid ?? ''),
                    )
                    .map(/** 解码真实资源，加载失败直接使测试失败。 */ (image) => image.decode()),
            ]);
            await document.fonts.ready;
        },
        excludedImages,
    );
    await paint(page);
}

/**
 * 打开首页并完成资源渐显、分批入场，循环动画保持零时刻。
 * @param page - 已安装动画捕获器的页面
 */
export async function openHome(page: Page) {
    // 空闲预取的路由模块可能被本用例闸门阻塞；首页就绪由下面的资源断言负责。
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('home-title')).toBeVisible({ timeout: 30000 });
    await prepareHomeAssets(page);
    await finishFinite(page);
}

/**
 * 完成现有有限动画，以便下一次交互从稳定状态开始。
 * @param page - 当前测试页面
 */
export async function finishFinite(page: Page) {
    await page.evaluate(
        /** 将有限动画推进到末尾，保留循环动画的当前相位。 */ () => {
            for (const animation of document.getAnimations()) {
                if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
            }
        },
    );
    await paint(page);
}

/**
 * 查找当前仍挂载的真实动画，并返回捕获表中的稳定编号及原始时间契约。
 * @param page - 当前测试页面
 * @param query - 业务区域、关键帧属性和时长等筛选条件
 */
export async function motions(page: Page, query: MotionQuery = {}) {
    return page.evaluate(
        /** 在浏览器中按名称、属性和业务标识筛选。 */ (filter) => {
            const all = Array.from(window.homeEntranceCapture.keys());
            return document
                .getAnimations()
                .filter(
                    /** 匹配动画及其所属业务区域。 */ (animation) => {
                        const effect = animation.effect as KeyframeEffect;
                        const name = animation instanceof CSSAnimation ? animation.animationName : '';
                        const property = animation instanceof CSSTransition ? animation.transitionProperty : '';
                        const scopes = filter.within
                            ? Array.from(document.querySelectorAll(`[data-testid="${filter.within}"]`))
                            : [];
                        const keys = effect.getKeyframes();
                        return (
                            (!filter.name || name.includes(filter.name)) &&
                            (!filter.property || property === filter.property) &&
                            (filter.duration === undefined || effect.getTiming().duration === filter.duration) &&
                            (!filter.keyframeProperty ||
                                keys.some(
                                    /** 根据动画属性定位，避免依赖构建哈希。 */ (key) =>
                                        filter.keyframeProperty! in key,
                                )) &&
                            (!filter.within ||
                                scopes.some(
                                    /** 同时支持桌面与移动布局中的同名控件。 */ (scope) =>
                                        scope.contains(effect.target) || effect.target?.contains(scope),
                                ))
                        );
                    },
                )
                .map(
                    /** 记录原始时序，用于防止缺失动画被接受为基准。 */ (animation) => ({
                        id: all.indexOf(animation),
                        name: animation instanceof CSSAnimation ? animation.animationName : '',
                        property: animation instanceof CSSTransition ? animation.transitionProperty : '',
                        duration: animation.effect!.getTiming().duration,
                        delay: animation.effect!.getTiming().delay,
                        iterations: animation.effect!.getTiming().iterations,
                        initialPlayState: window.homeEntranceCapture.get(animation)?.initialPlayState,
                    }),
                );
        },
        query,
    );
}

/**
 * 验证动画实际启动以及时长、数量，返回可精确定位的动画编号。
 * @param page - 当前测试页面
 * @param query - 动画筛选条件
 * @param duration - 预期持续时间，单位为毫秒
 * @param count - 预期动画数量
 */
export async function requireMotion(page: Page, query: MotionQuery, duration: number, count = 1) {
    await expect
        .poll(
            /** 等待动画被逐帧捕获。 */ async () =>
                (await motions(page, query)).filter(/** 只计入已记录初始状态的动画。 */ (motion) => motion.id >= 0)
                    .length,
            {
                timeout: 5000,
                message: `动画契约 ${JSON.stringify(query)}；当前动画 ${JSON.stringify(await motions(page))}`,
            },
        )
        .toBe(count);
    const found = await motions(page, query);
    for (const motion of found) {
        expect(motion.id).toBeGreaterThanOrEqual(0);
        expect(motion.initialPlayState).toBe('running');
        expect(motion.duration).toBe(duration);
    }
    return found.map(/** 提取稳定编号。 */ (motion) => motion.id);
}

/**
 * 在统一时间轴推进选定动画，保留各自延迟，有限动画最多推进到末尾前 1ms。
 * @param page - 当前测试页面
 * @param ids - 已捕获动画的稳定编号
 * @param milliseconds - 包含延迟在内的目标毫秒时间
 */
export async function seek(page: Page, ids: number[], milliseconds: number) {
    await page.evaluate(
        /** 设置捕获到的原始动画时间，不改写关键帧。 */ ({ selected, time }) => {
            const all = Array.from(window.homeEntranceCapture.keys());
            for (const id of selected) {
                if (!document.getAnimations().includes(all[id])) throw new Error(`所测动画已被取消或移除：${id}`);
                const timing = all[id].effect!.getComputedTiming();
                all[id].pause();
                // 非填充动画在结束后会退出活动列表；取末尾前 1 毫秒，避免浏览器时间精度舍入。
                all[id].currentTime = Math.min(time, Number(timing.endTime) - 1);
            }
        },
        { selected: ids, time: milliseconds },
    );
    await paint(page);
}

/**
 * 截取暂停动画，并校验截图未重建、取消或推进所测动画。
 * @param page - 当前测试页面
 * @param name - 不带扩展名的基准图片名称
 * @param ids - 此帧需要验证的动画编号
 * @param time - 统一时间轴上的目标毫秒时间
 * @param region - 可选的局部截图区域
 * @param padding - 局部区域外保留的阴影边距，单位为像素
 */
export async function frame(page: Page, name: string, ids: number[], time: number, region?: Locator, padding = 0) {
    await seek(page, ids, time);
    const clip = region ? await region.boundingBox() : undefined;
    if (region) expect(clip, '截图区域必须存在').toBeTruthy();
    if (clip && padding) {
        clip.x -= padding;
        clip.y -= padding;
        clip.width += padding * 2;
        clip.height += padding * 2;
    }
    const screenshot = await page.screenshot({
        animations: 'allow',
        caret: 'hide',
        scale: 'css',
        clip: clip ?? undefined,
    });
    const states = await page.evaluate(
        /** 核验截图后的原始动画和时间。 */ (selected) => {
            const all = Array.from(window.homeEntranceCapture.keys());
            const live = document.getAnimations();
            return selected.map(
                /** 读取单个动画的挂载和暂停状态。 */ (id) => ({
                    live: live.includes(all[id]),
                    time: all[id].currentTime,
                    state: all[id].playState,
                    endTime: all[id].effect!.getComputedTiming().endTime,
                    label: all[id] instanceof CSSTransition ? (all[id] as CSSTransition).transitionProperty : '关键帧',
                }),
            );
        },
        ids,
    );
    for (const state of states) {
        expect(state.live, `所测动画在截图期间不能消失：${JSON.stringify(state)}`).toBe(true);
        expect(state.state).toBe('paused');
        expect(state.time).toBeCloseTo(Math.min(time, Number(state.endTime) - 1), 3);
    }
    expect(screenshot).toMatchSnapshot(`${name}.png`);
}

/**
 * 创建可显式释放的请求闸门，避免用固定睡眠猜测加载窗口。
 * @param page - 当前测试页面
 * @param pattern - 需要暂缓返回的资源匹配条件
 */
export async function holdRequests(page: Page, pattern: string | RegExp | ((url: URL) => boolean)) {
    let release!: () => void;
    const gate = new Promise<void>(
        /** 保存显式释放请求的通知函数。 */ (resolve) => {
            release = resolve;
        },
    );
    let requests = 0;
    await page.route(
        pattern,
        /** 等待测试释放请求后再访问真实资源。 */ async (route) => {
            requests += 1;
            await gate;
            await route.continue();
        },
    );
    return { release, count: /** 返回已拦截请求数。 */ () => requests };
}
