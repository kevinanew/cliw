#!/usr/bin/env node

const ROTATION = Object.freeze([
    Object.freeze({ locale: 'zh', viewport: 'desktop' }),
    Object.freeze({ locale: 'zh-TW', viewport: 'mobile' }),
    Object.freeze({ locale: 'en', viewport: 'small-desktop' }),
    Object.freeze({ locale: 'zh', viewport: 'pixel-9' }),
    Object.freeze({ locale: 'zh-TW', viewport: 'desktop' }),
    Object.freeze({ locale: 'en', viewport: 'mobile' }),
    Object.freeze({ locale: 'zh', viewport: 'small-desktop' }),
    Object.freeze({ locale: 'zh-TW', viewport: 'pixel-9' }),
    Object.freeze({ locale: 'en', viewport: 'desktop' }),
    Object.freeze({ locale: 'zh', viewport: 'mobile' }),
    Object.freeze({ locale: 'zh-TW', viewport: 'small-desktop' }),
    Object.freeze({ locale: 'en', viewport: 'pixel-9' }),
]);

function selectVisualRotation(pipelineNumber) {
    const raw = String(pipelineNumber ?? '');
    if (!/^\d+$/.test(raw)) {
        throw new Error(`CI_PIPELINE_NUMBER must be a non-negative integer; received "${raw}"`);
    }

    const number = Number(raw);
    if (!Number.isSafeInteger(number)) {
        throw new Error(`CI_PIPELINE_NUMBER must be a safe non-negative integer; received "${raw}"`);
    }

    const index = number % ROTATION.length;
    return { pipelineNumber: number, index, ...ROTATION[index] };
}

if (require.main === module) {
    try {
        const selection = selectVisualRotation(process.argv[2]);
        // Values come exclusively from the fixed table and are safe shell assignment values.
        console.log(`export VISUAL_ROTATION_INDEX=${selection.index}`);
        console.log(`export VISUAL_LOCALES=${selection.locale}`);
        console.log(`export VISUAL_VIEWPORTS=${selection.viewport}`);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = { ROTATION, selectVisualRotation };
