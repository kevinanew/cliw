const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validateMissingSourceMap } = require('./source-map-checker');

function response(status, contentType, body) {
    return {
        status,
        headers: new Headers({ 'content-type': contentType }),
        text: async () => body,
    };
}

describe('source-map-checker', () => {
    it('接受不包含首页 HTML 的 404', async () => {
        assert.equal(await validateMissingSourceMap(response(404, 'text/html', '<h1>404 Not Found</h1>')), null);
    });

    it('拒绝被首页兜底的 200 HTML', async () => {
        assert.match(
            await validateMissingSourceMap(response(200, 'text/html', '<!doctype html><html><body>来玩</body></html>')),
            /期望 HTTP 404/,
        );
    });

    it('允许 nginx 的普通 HTML 404 页，但拒绝首页 HTML', async () => {
        assert.equal(
            await validateMissingSourceMap(response(404, 'text/html', '<html><body>404 Not Found</body></html>')),
            null,
        );
        assert.match(
            await validateMissingSourceMap(
                response(404, 'text/html', '<html><body><div id="laiwan"></div></body></html>'),
            ),
            /不应返回 SPA 首页 HTML/,
        );
    });
});
