const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateHead } = require('./seo-checker');

const VALID_HEAD = `
<html lang="en"><head>
<title>Learning</title>
<meta name="description" content="Learn Texas Hold’em" />
<meta property="og:title" content="Learning" />
<meta property="og:description" content="Learn Texas Hold’em" />
</head></html>`;

describe('seo-checker 页面元数据', () => {
    it('接受与域名无关的标题和描述', () => {
        assert.deepEqual(validateHead(VALID_HEAD, 'en'), []);
    });

    it('报告缺失的语言和描述，以及旧的绝对地址标签', () => {
        const html = VALID_HEAD.replace('lang="en"', 'lang="zh"')
            .replace('<meta name="description" content="Learn Texas Hold’em" />', '')
            .replace('</head>', '<link rel="canonical" href="https://old.example/" /></head>');
        const issues = validateHead(html, 'en');
        assert.ok(issues.some((issue) => issue.includes('<html lang>')));
        assert.ok(issues.some((issue) => issue.includes('缺少页面描述')));
        assert.ok(issues.some((issue) => issue.includes('canonical')));
    });
});
