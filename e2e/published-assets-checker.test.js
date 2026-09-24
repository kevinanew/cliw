const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
    REQUIRED_BOOK_ASSET_PATHS,
    isSiteAssetPathname,
    assetBasenameFromUrl,
    extractEntryAssetsFromHtml,
    parseWebpackChunkAssets,
    findUnreachableAssets,
    findUnreachableResources,
} = require('./published-assets-checker');

describe('published-assets', () => {
    it('只校验学习页当前引用且已发布的书封面', () => {
        assert.deepEqual(REQUIRED_BOOK_ASSET_PATHS, [
            '/book/no-limit-holdem-advanced-en_cover.jpg',
            '/book/no-limit-holdem-advanced-zh_cover.jpg',
            '/book/德州扑克战术与策略分析-赵春阳_cover.jpg',
        ]);
    });

    it('isSiteAssetPathname 只接受 /assets 下的 js/css', () => {
        assert.equal(isSiteAssetPathname('/assets/main.abc12345.js'), true);
        assert.equal(isSiteAssetPathname('/assets/main.abc12345.css'), true);
        assert.equal(isSiteAssetPathname('/assets/nested/main.js'), false);
        assert.equal(isSiteAssetPathname('/icon.png'), false);
        assert.equal(isSiteAssetPathname('/assets/main.js.map'), false);
    });

    it('assetBasenameFromUrl 提取同源 assets basename', () => {
        const origin = 'https://staging.example.test';
        assert.equal(assetBasenameFromUrl(`${origin}/assets/main.20575b0e.js`, origin), 'main.20575b0e.js');
        assert.equal(assetBasenameFromUrl('/assets/main.0f29a05a.css', origin), 'main.0f29a05a.css');
        assert.equal(assetBasenameFromUrl('https://cdn.example.com/assets/x.js', origin), null);
        assert.equal(assetBasenameFromUrl(`${origin}/icon.png`, origin), null);
    });

    it('extractEntryAssetsFromHtml 解析 script 与 stylesheet（含属性顺序/引号差异）', () => {
        const origin = 'https://staging.example.test';
        const html =
            '<script defer src="/assets/react.02de9aa7.js"></script>' +
            '<script src=\'/assets/main.20575b0e.js\' defer="defer"></script>' +
            '<link href="/assets/main.0f29a05a.css" rel="stylesheet">' +
            "<link rel='stylesheet' href=/assets/vendor.a06fce4d.css>" +
            '<link rel="icon" href="/icon.png">' +
            '<link rel="stylesheet" href="https://cdn.example.com/x.css">' +
            '<script>/* inline */</script>';
        assert.deepEqual(extractEntryAssetsFromHtml(html, origin), [
            'main.0f29a05a.css',
            'main.20575b0e.js',
            'react.02de9aa7.js',
            'vendor.a06fce4d.css',
        ]);
    });

    it('parseWebpackChunkAssets 从 runtime 映射还原 chunk 文件名', () => {
        const source =
            'o.u=e=>"assets/"+e+"."+{45:"bca267d1",806:"f0c5f3fb"}[e]+".js",' +
            'o.miniCssF=e=>"assets/"+e+"."+{45:"81573454",806:"191f78e6"}[e]+".css"';
        assert.deepEqual(parseWebpackChunkAssets(source), [
            '45.81573454.css',
            '45.bca267d1.js',
            '806.191f78e6.css',
            '806.f0c5f3fb.js',
        ]);
    });

    it('parseWebpackChunkAssets 无映射时返回空数组', () => {
        assert.deepEqual(parseWebpackChunkAssets('console.log(1)'), []);
    });

    it('findUnreachableAssets 返回 HTTP 失败的 basename', async () => {
        const origin = 'https://staging.example.test';
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async (url, options = {}) => {
            const href = String(url);
            if (href.endsWith('/missing.js')) {
                return { ok: false, status: 404 };
            }
            if (options.method === 'HEAD') {
                return { ok: true, status: 200 };
            }
            return { ok: true, status: 200 };
        });
        try {
            const missing = await findUnreachableAssets(origin, ['main.ok.js', 'missing.js', 'main.ok.js']);
            assert.deepEqual(missing, ['missing.js (HTTP 404)']);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('findUnreachableResources 检查同源书封面路径并去重', async () => {
        const origin = 'https://staging.example.test';
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async (url) => {
            const href = String(url);
            return href.endsWith('/missing.webp') ? { ok: false, status: 404 } : { ok: true, status: 200 };
        });
        try {
            const missing = await findUnreachableResources(origin, [
                '/book/ok.jpg',
                '/book/missing.webp',
                '/book/ok.jpg',
            ]);
            assert.deepEqual(missing, ['/book/missing.webp (HTTP 404)']);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
