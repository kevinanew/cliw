const { materializeImagesForScreenshot } = require('./preparePage');
const { chromium } = require('@playwright/test');

function createImage({
    complete,
    loading = 'auto',
    naturalWidth = complete ? 100 : 0,
    src = '/cover.jpg',
    loadOnScroll = true,
}) {
    const listeners = new Map();
    let currentLoading = loading;
    let currentSrc = src;

    return {
        complete,
        naturalWidth,
        get src() {
            return currentSrc;
        },
        set src(value) {
            currentSrc = value;
            if (this.naturalWidth === 0) {
                this.complete = false;
                queueMicrotask(() => {
                    this.complete = true;
                    this.naturalWidth = 100;
                    listeners.get('load')?.();
                });
            }
        },
        get currentSrc() {
            return currentSrc;
        },
        get loading() {
            return currentLoading;
        },
        set loading(value) {
            currentLoading = value;
        },
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        removeEventListener(type, listener) {
            if (listeners.get(type) === listener) {
                listeners.delete(type);
            }
        },
        scrollIntoView: jest.fn(function () {
            if (loadOnScroll && this.naturalWidth === 0) {
                queueMicrotask(() => {
                    this.complete = true;
                    this.naturalWidth = 100;
                    listeners.get('load')?.();
                });
            }
        }),
        decode: jest.fn(function () {
            if (this.complete && this.naturalWidth > 0) return Promise.resolve();
            return new Promise((resolve) => listeners.set('load', resolve));
        }),
    };
}

describe('materializeImagesForScreenshot', () => {
    afterEach(() => {
        delete global.document;
        delete global.requestAnimationFrame;
        jest.restoreAllMocks();
    });

    test('触发视口外的懒加载图片并等待完成', async () => {
        const completedImage = createImage({ complete: true, loading: 'lazy' });
        const pendingLazyImage = createImage({ complete: false, loading: 'lazy' });
        const deferredButCompleteImage = createImage({
            complete: true,
            loading: 'lazy',
            naturalWidth: 0,
            loadOnScroll: false,
        });
        const deferredSrcSetter = jest.spyOn(deferredButCompleteImage, 'src', 'set');
        global.document = {
            images: [completedImage, pendingLazyImage, deferredButCompleteImage],
            querySelectorAll: jest.fn(() => []),
        };

        await materializeImagesForScreenshot();

        expect(completedImage.loading).toBe('eager');
        expect(pendingLazyImage.loading).toBe('eager');
        expect(pendingLazyImage.complete).toBe(true);
        expect(deferredButCompleteImage.loading).toBe('eager');
        expect(deferredButCompleteImage.naturalWidth).toBe(100);
        expect(deferredSrcSetter).toHaveBeenCalledWith('/cover.jpg');
        expect(completedImage.scrollIntoView).not.toHaveBeenCalled();
        expect(pendingLazyImage.scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
        expect(deferredButCompleteImage.scrollIntoView).toHaveBeenCalledWith({
            block: 'center',
            inline: 'nearest',
        });
        expect(completedImage.decode).toHaveBeenCalledTimes(1);
        expect(pendingLazyImage.decode).toHaveBeenCalledTimes(1);
        expect(deferredButCompleteImage.decode).toHaveBeenCalledTimes(1);
    });

    test('仅物化缺少 src 的教程步骤图', async () => {
        const missingSource = { dataset: { tutorialSrcSet: '/step.webp 1x' }, srcset: '' };
        const missingImage = {
            getAttribute: jest.fn(() => ''),
            closest: jest.fn(() => ({ querySelector: () => missingSource })),
            dataset: { tutorialSrc: '/step.jpg' },
            src: '',
        };
        const existingSource = { dataset: { tutorialSrcSet: '/new.webp 1x' }, srcset: '/old.webp 1x' };
        const existingImage = {
            getAttribute: jest.fn(() => '/existing.jpg'),
            closest: jest.fn(() => ({ querySelector: () => existingSource })),
            dataset: { tutorialSrc: '/new.jpg', loaded: 'before' },
            src: '/existing.jpg',
        };
        global.document = {
            images: [],
            querySelectorAll: jest.fn(() => [missingImage, existingImage]),
        };

        await materializeImagesForScreenshot();

        expect(missingSource.srcset).toBe('/step.webp 1x');
        expect(missingImage.src).toBe('/step.jpg');
        expect(missingImage.dataset.loaded).toBe('true');
        expect(existingSource.srcset).toBe('/old.webp 1x');
        expect(existingImage.src).toBe('/existing.jpg');
        expect(existingImage.dataset.loaded).toBe('before');
        expect(existingImage.closest).not.toHaveBeenCalled();
    });

    test('已有资源性能条目时不重复设置 src', async () => {
        const image = createImage({ complete: true, loading: 'lazy', naturalWidth: 0, loadOnScroll: false });
        const srcSetter = jest.spyOn(image, 'src', 'set');
        image.decode.mockResolvedValue();
        jest.spyOn(global.performance, 'getEntriesByName').mockReturnValue([{}]);
        global.document = { images: [image], querySelectorAll: () => [] };

        await materializeImagesForScreenshot();

        expect(srcSetter).not.toHaveBeenCalled();
        expect(image.decode).toHaveBeenCalledTimes(1);
    });

    test('无 Performance API 时安全地按已选 URL 启动请求', async () => {
        const originalPerformance = global.performance;
        const image = createImage({ complete: true, loading: 'lazy', naturalWidth: 0, loadOnScroll: false });
        const srcSetter = jest.spyOn(image, 'src', 'set');
        global.document = { images: [image], querySelectorAll: () => [] };
        Object.defineProperty(global, 'performance', { configurable: true, value: undefined });

        try {
            await materializeImagesForScreenshot();
            expect(srcSetter).toHaveBeenCalledWith('/cover.jpg');
        } finally {
            Object.defineProperty(global, 'performance', { configurable: true, value: originalPerformance });
        }
    });

    test('非 lazy 图片保持 loading 且仍执行 decode', async () => {
        const image = createImage({ complete: true, loading: 'auto', naturalWidth: 0 });
        const srcSetter = jest.spyOn(image, 'src', 'set');
        image.decode.mockResolvedValue();
        global.document = { images: [image], querySelectorAll: () => [] };

        await expect(materializeImagesForScreenshot()).resolves.toBeUndefined();

        expect(image.loading).toBe('auto');
        expect(image.scrollIntoView).not.toHaveBeenCalled();
        expect(srcSetter).not.toHaveBeenCalled();
        expect(image.decode).toHaveBeenCalledTimes(1);
    });

    test('无需滚动时在 loading 变更触发的微任务前调用 decode', async () => {
        const events = [];
        const image = createImage({ complete: true, loading: 'lazy' });
        let currentLoading = image.loading;
        Object.defineProperty(image, 'loading', {
            configurable: true,
            get: () => currentLoading,
            set: (value) => {
                currentLoading = value;
                events.push('loading-set');
                queueMicrotask(() => events.push('loading-observer'));
            },
        });
        image.decode.mockImplementation(() => {
            events.push('decode-call');
            return Promise.resolve();
        });
        global.document = { images: [image], querySelectorAll: () => [] };

        await materializeImagesForScreenshot();

        expect(image.scrollIntoView).not.toHaveBeenCalled();
        expect(events).toEqual(['loading-set', 'decode-call', 'loading-observer']);
    });

    test('decode 拒绝或无绘制像素时继续逐张处理', async () => {
        const order = [];
        let releaseFirstDecode;
        const rejected = createImage({ complete: true });
        rejected.decode.mockImplementation(() => {
            order.push('first');
            return new Promise((resolve, reject) => {
                releaseFirstDecode = () => reject(new Error('decode failed'));
            });
        });
        const zeroWidth = createImage({ complete: true, naturalWidth: 0 });
        zeroWidth.decode.mockImplementation(async () => order.push('second'));
        const succeeding = createImage({ complete: true });
        succeeding.decode.mockImplementation(async () => order.push('third'));
        global.document = { images: [rejected, zeroWidth, succeeding], querySelectorAll: () => [] };

        const materialization = materializeImagesForScreenshot();
        await Promise.resolve();
        expect(order).toEqual(['first']);
        releaseFirstDecode();
        await expect(materialization).resolves.toBeUndefined();

        expect(order).toEqual(['first', 'second', 'third']);
    });

    test('每次滚动后等待双帧，并在全部 decode 后最终等待双帧', async () => {
        const events = [];
        global.requestAnimationFrame = jest.fn((callback) => {
            events.push('frame');
            callback();
        });
        const first = createImage({ complete: false, loading: 'lazy', loadOnScroll: false });
        first.scrollIntoView.mockImplementation(() => events.push('scroll'));
        first.decode.mockImplementation(async () => events.push('decode-first'));
        const second = createImage({ complete: true });
        second.decode.mockImplementation(async () => events.push('decode-second'));
        global.document = { images: [first, second], querySelectorAll: () => [] };

        await materializeImagesForScreenshot();

        expect(events).toEqual(['scroll', 'frame', 'frame', 'decode-first', 'decode-second', 'frame', 'frame']);
    });

    test('序列化后的函数不依赖模块闭包，且无 requestAnimationFrame 时立即完成', async () => {
        const serializedFunction = Function(`return (${materializeImagesForScreenshot.toString()})`)();
        const image = createImage({ complete: true, loading: 'auto' });
        global.document = { images: [image], querySelectorAll: () => [] };

        await expect(serializedFunction()).resolves.toBeUndefined();
        expect(image.decode).toHaveBeenCalledTimes(1);
    });

    test('真实 Chromium 中无滚动路径在 MutationObserver 前调用 decode', async () => {
        const browser = await chromium.launch();

        try {
            const page = await browser.newPage();
            await page.setContent(
                '<img id="image" loading="lazy" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">',
            );
            await page.waitForFunction(() => {
                const image = document.querySelector('#image');
                return image.complete && image.naturalWidth > 0;
            });
            await page.evaluate(() => {
                const image = document.querySelector('#image');
                window.imageEvents = [];
                window.loadingObserver = new MutationObserver(() => window.imageEvents.push('loading-observer'));
                window.loadingObserver.observe(image, { attributes: true, attributeFilter: ['loading'] });
                image.decode = () => {
                    window.imageEvents.push('decode-call');
                    return Promise.resolve();
                };
            });

            await page.evaluate(materializeImagesForScreenshot);

            await expect(page.evaluate(() => window.imageEvents)).resolves.toEqual(['decode-call', 'loading-observer']);
        } finally {
            await browser.close();
        }
    });
});
