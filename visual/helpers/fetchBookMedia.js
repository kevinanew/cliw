const BOOK_MEDIA_ORIGINS = [
    'https://goplay-web-static-staging.jp-tyo-1.linodeobjects.com',
    'https://goplay-web-static-production.jp-tyo-1.linodeobjects.com',
];
const BOOK_MEDIA_FETCH_ATTEMPTS = 3;
const BOOK_MEDIA_FETCH_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetchImpl(url, { signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchBookMedia(
    pathname,
    {
        fetchImpl = fetch,
        origins = BOOK_MEDIA_ORIGINS,
        attempts = BOOK_MEDIA_FETCH_ATTEMPTS,
        timeoutMs = BOOK_MEDIA_FETCH_TIMEOUT_MS,
    } = {},
) {
    let lastError;
    let lastResponse;

    for (const origin of origins) {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const response = await fetchWithTimeout(new URL(pathname, origin), fetchImpl, timeoutMs);
                if (response.ok) return response;
                lastResponse = response;
                break;
            } catch (error) {
                lastError = error;
            }
        }
    }

    if (lastResponse) return lastResponse;
    throw lastError;
}

module.exports = {
    BOOK_MEDIA_FETCH_ATTEMPTS,
    BOOK_MEDIA_FETCH_TIMEOUT_MS,
    BOOK_MEDIA_ORIGINS,
    fetchBookMedia,
};
