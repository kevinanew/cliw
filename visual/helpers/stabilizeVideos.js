/**
 * 暂停背景视频并固定为 poster 状态，避免截图时因播放进度不同产生像素差异。
 * VideoBackground 通过 requestAnimationFrame 控制 opacity，CSS 动画禁用对此无效。
 * imageFallback 的 ken-burns 动画被禁用后仍可能停在中间帧，需重置 transform。
 */
module.exports = {
    async apply(page) {
        await page.evaluate(async () => {
            document.querySelectorAll('[data-testid="video-background-image"]').forEach((el) => {
                el.style.animation = 'none';
                el.style.transform = 'none';
            });

            const videos = Array.from(document.querySelectorAll('video'));
            if (videos.length === 0) {
                return;
            }

            await Promise.all(
                videos.map(
                    (video) =>
                        new Promise((resolve) => {
                            const stabilize = () => {
                                video.pause();
                                video.autoplay = false;
                                video.loop = false;
                                try {
                                    video.currentTime = 0;
                                } catch {
                                    // 部分浏览器在 metadata 未就绪时 seek 会抛错，忽略即可
                                }
                                video.style.opacity = '0';
                                resolve();
                            };

                            if (video.readyState >= 1) {
                                stabilize();
                                return;
                            }

                            video.addEventListener('loadeddata', stabilize, { once: true });
                            setTimeout(stabilize, 2000);
                        }),
                ),
            );
        });
    },
};
