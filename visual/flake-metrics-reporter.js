const fs = require('node:fs');
const path = require('node:path');

/**
 * Records the flaky outcome that matters for visual regression: an initial
 * failure followed by a passing retry.  A separate JSON file per CI run makes
 * the data cheap to retain and aggregate without scraping CI logs.
 */
class FlakeMetricsReporter {
    constructor(options = {}) {
        this.outputFile = path.resolve(options.outputFile || 'visual-retry-metrics.json');
        this.events = [];
        this.startedAt = null;
    }

    onBegin() {
        this.startedAt = new Date().toISOString();
    }

    onTestEnd(test, result) {
        // Playwright only schedules a retry after a previous attempt failed.
        if (result.status !== 'passed' || result.retry < 1) {
            return;
        }

        this.events.push({
            event: 'first-failure-retry-pass',
            timestamp: result.startTime ? result.startTime.toISOString() : new Date().toISOString(),
            scenario: test.title,
            titlePath: test.titlePath(),
            project: test.parent.project()?.name || null,
            retry: result.retry,
            durationMs: result.duration,
            workerIndex: result.workerIndex,
        });
    }

    onEnd(result) {
        const payload = {
            schemaVersion: 1,
            startedAt: this.startedAt,
            finishedAt: new Date().toISOString(),
            status: result.status,
            ci: {
                pipelineNumber: process.env.CI_PIPELINE_NUMBER || null,
                pipelineUrl: process.env.CI_PIPELINE_URL || null,
                commitSha: process.env.CI_COMMIT_SHA || null,
                event: process.env.CI_PIPELINE_EVENT || null,
            },
            retryPasses: this.events,
        };

        fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
        fs.writeFileSync(this.outputFile, `${JSON.stringify(payload, null, 2)}\n`);
    }
}

module.exports = FlakeMetricsReporter;
