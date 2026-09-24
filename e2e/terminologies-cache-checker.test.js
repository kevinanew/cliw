const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isOneHourPublicCache, terminologyIndexUrl } = require('./terminologies-cache-checker');

describe('terminologies-cache-checker', () => {
    it('terminologyIndexUrl 保持 /terminologies/ 路径', () => {
        assert.equal(
            terminologyIndexUrl('https://staging.example.test/'),
            'https://staging.example.test/terminologies/zh/index.json',
        );
    });

    it('isOneHourPublicCache 接受 public, max-age=3600', () => {
        assert.equal(isOneHourPublicCache('public, max-age=3600'), true);
        assert.equal(isOneHourPublicCache('max-age=3600, public'), true);
        assert.equal(isOneHourPublicCache('Public, Max-Age=3600'), true);
    });

    it('isOneHourPublicCache 拒绝错误缓存策略', () => {
        assert.equal(isOneHourPublicCache(null), false);
        assert.equal(isOneHourPublicCache(''), false);
        assert.equal(isOneHourPublicCache('no-cache'), false);
        assert.equal(isOneHourPublicCache('public, max-age=60'), false);
        assert.equal(isOneHourPublicCache('public, max-age=36000'), false);
        assert.equal(isOneHourPublicCache('max-age=3600'), false);
    });
});
