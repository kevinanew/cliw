const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const FlakeMetricsReporter = require('./flake-metrics-reporter');

test('records only a failed first attempt that passes on retry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-flake-metrics-'));
    const outputFile = path.join(dir, 'metrics.json');
    const reporter = new FlakeMetricsReporter({ outputFile });
    const scenario = {
        title: 'zh_desktop_homepage',
        titlePath: () => ['visual.spec.js', 'zh_desktop_homepage'],
        parent: { project: () => ({ name: 'chromium' }) },
    };

    reporter.onBegin();
    reporter.onTestEnd(scenario, { status: 'failed', retry: 0, duration: 10, workerIndex: 0 });
    reporter.onTestEnd(scenario, {
        status: 'passed',
        retry: 1,
        duration: 20,
        workerIndex: 0,
        startTime: new Date('2026-07-24T00:00:00.000Z'),
    });
    reporter.onEnd({ status: 'passed' });

    const metrics = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    assert.equal(metrics.status, 'passed');
    assert.deepEqual(metrics.retryPasses, [
        {
            event: 'first-failure-retry-pass',
            timestamp: '2026-07-24T00:00:00.000Z',
            scenario: 'zh_desktop_homepage',
            titlePath: ['visual.spec.js', 'zh_desktop_homepage'],
            project: 'chromium',
            retry: 1,
            durationMs: 20,
            workerIndex: 0,
        },
    ]);
});
