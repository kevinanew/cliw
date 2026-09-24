const { ROTATION, selectVisualRotation } = require('./visual-rotation');
const { buildScenarios } = require('./scenarios');

const EXPECTED = [
    ['zh', 'desktop'],
    ['zh-TW', 'mobile'],
    ['en', 'small-desktop'],
    ['zh', 'pixel-9'],
    ['zh-TW', 'desktop'],
    ['en', 'mobile'],
    ['zh', 'small-desktop'],
    ['zh-TW', 'pixel-9'],
    ['en', 'desktop'],
    ['zh', 'mobile'],
    ['zh-TW', 'small-desktop'],
    ['en', 'pixel-9'],
];

describe('visual rotation', () => {
    test('0..11 与固定表一致，12 开始重复', () => {
        EXPECTED.forEach(([locale, viewport], index) => {
            expect(selectVisualRotation(index)).toEqual({ pipelineNumber: index, index, locale, viewport });
        });
        expect(selectVisualRotation(12)).toMatchObject({ index: 0, locale: 'zh', viewport: 'desktop' });
    });

    test('12 个结果无重复并覆盖 3×4 矩阵', () => {
        expect(ROTATION).toHaveLength(12);
        expect(new Set(ROTATION.map(({ locale, viewport }) => `${locale}/${viewport}`)).size).toBe(12);
    });

    test('每个轮换组合都生成至少一个场景', () => {
        ROTATION.forEach(({ locale, viewport }) => {
            expect(
                buildScenarios('http://127.0.0.1:8080', { localesEnv: locale, viewportsEnv: viewport }).length,
            ).toBeGreaterThan(0);
        });
    });

    test('同一编号结果稳定', () => {
        expect(selectVisualRotation('12345')).toEqual(selectVisualRotation('12345'));
    });

    test.each([undefined, '', 'abc', '-1', '1.5', Number.MAX_SAFE_INTEGER + 1])('非法编号 %p 失败', (value) => {
        expect(() => selectVisualRotation(value)).toThrow(/CI_PIPELINE_NUMBER/);
    });
});
