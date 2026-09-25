const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    APK_PATH,
    HTTPS_REDIRECT_STATUS_CODES,
    assertTrailingSlashRedirect,
    httpOriginFor,
    makeUrl,
    readHomepageTargets,
    redirectMatches,
} = require('./https-redirect-checker');

describe('https-redirect-checker helpers', () => {
    it('将 HTTPS 域名转换为对应 HTTP 域名', () => {
        assert.equal(httpOriginFor('https://staging.example.test/'), 'http://staging.example.test');
        assert.throws(() => httpOriginFor('http://localhost:8080/'), /https:\/\//);
    });

    it('保留页面路由、查询参数及已编码 APK 文件名', () => {
        const origin = 'https://staging.example.test/';
        assert.equal(
            makeUrl(origin, '/glossary?source=https-redirect-check&lang=zh'),
            'https://staging.example.test/glossary?source=https-redirect-check&lang=zh',
        );
        assert.equal(
            makeUrl(origin, APK_PATH),
            'https://staging.example.test/apk/%E6%9D%A5%E7%8E%A9Dev-2.0.2602041721.apk?channel=https-redirect-check',
        );
    });

    it('只接受 301/308 且 Location 完全匹配的 HTTPS 重定向', () => {
        const expected = 'https://staging.example.test/apk/%E6%9D%A5%E7%8E%A9.apk';
        const response = (status, location) => ({ status, headers: new Headers({ location }) });
        assert.equal(redirectMatches(response(308, expected), expected), true);
        assert.equal(redirectMatches(response(301, expected), expected), true);
        assert.equal(redirectMatches(response(302, expected), expected), false);
        assert.equal(
            redirectMatches(response(308, 'https://staging.example.test/apk/%E6%9D%A5%E7%8E%A9.apk?lost=1'), expected),
            false,
        );
        assert.equal(HTTPS_REDIRECT_STATUS_CODES.has(308), true);
    });

    it('从首页读取同源静态资源地址', async () => {
        const httpsOrigin = 'https://source.example.test';
        const fetchImpl = async (url, options) => {
            assert.equal(url, `${httpsOrigin}/`);
            assert.deepEqual(options, { redirect: 'error' });
            return {
                ok: true,
                text: async () => '<html><body><script src="/static/app.js?v=1"></script></body></html>',
            };
        };

        assert.deepEqual(await readHomepageTargets(httpsOrigin, fetchImpl), {
            staticAssetPath: '/static/app.js?v=1',
        });
    });

    it('尾随斜杠跳转保留访问域名和全部查询参数', async () => {
        const httpsOrigin = 'https://staging.example.test';
        const location = '/tutorial?lang=en&ref=trailing-slash-redirect-check';
        const requests = [];
        const fetchImpl = async (url, options) => {
            requests.push({ url, options });
            if (requests.length === 1) {
                return { status: 308, headers: new Headers({ location }) };
            }
            return { ok: true, status: 200, text: async () => '<html lang="en"></html>' };
        };

        await assertTrailingSlashRedirect({ httpsOrigin, pathname: '/tutorial', fetchImpl });

        assert.deepEqual(requests, [
            {
                url: `${httpsOrigin}/tutorial/?lang=en&ref=trailing-slash-redirect-check`,
                options: { redirect: 'manual' },
            },
            { url: `${httpsOrigin}${location}`, options: { redirect: 'error' } },
        ]);
    });
});
