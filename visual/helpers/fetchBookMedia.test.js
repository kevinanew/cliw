const { fetchBookMedia } = require('./fetchBookMedia');

describe('fetchBookMedia', () => {
    test('挂起请求超时后继续重试并回退 production', async () => {
        const requestedOrigins = [];
        const hangingFetch = (url, { signal }) => {
            requestedOrigins.push(url.origin);
            if (url.origin.endsWith('staging.example')) {
                return new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                });
            }
            return Promise.resolve({ ok: true, status: 200 });
        };

        const response = await fetchBookMedia('/book/cover.jpg', {
            fetchImpl: hangingFetch,
            origins: ['https://staging.example', 'https://production.example'],
            attempts: 2,
            timeoutMs: 5,
        });

        expect(response).toMatchObject({ ok: true, status: 200 });
        expect(requestedOrigins).toEqual([
            'https://staging.example',
            'https://staging.example',
            'https://production.example',
        ]);
    });
});
