const assert = require('node:assert/strict');
const test = require('node:test');
const { isCspViolationConsoleMessage, isCspViolationMessage } = require('./playwright-checker');

test('Playwright 只把真正的 CSP 违规计为失败', () => {
    assert.equal(
        isCspViolationMessage(
            "[Report Only] The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.",
        ),
        false,
    );
    assert.equal(
        isCspViolationMessage(
            "Refused to apply inline style because it violates the following Content Security Policy directive: style-src 'self'.",
        ),
        true,
    );
    assert.equal(
        isCspViolationConsoleMessage(
            'info',
            "[Report Only] Refused to apply inline style because it violates the following Content Security Policy directive: style-src 'self'. The policy is report-only, so the violation was logged but no further action was taken.",
        ),
        true,
    );
    assert.equal(isCspViolationConsoleMessage('info', 'Content Security Policy is enabled for this page'), false);
});
