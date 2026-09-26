const { open, stat } = require('node:fs/promises');
const { test, expect } = require('@playwright/test');

const books = [
    {
        title: '无限德州扑克进阶指南',
        cardId: 'learning-book-no-limit-holdem-advanced-zh',
        path: '/book/no-limit-holdem-advanced-zh.pdf',
        filename: '无限德州扑克进阶指南.pdf',
    },
    {
        title: '德州扑克战术与策略分析',
        cardId: 'learning-book-poker-tactics-zh',
        path: '/book/德州扑克战术与策略分析-赵春阳.pdf',
        filename: '德州扑克战术与策略分析-赵春阳.pdf',
    },
    {
        title: '德州扑克小绿皮书',
        cardId: 'learning-book-little-green-book-zh',
        path: '/book/德州扑克小绿皮书.pdf',
        filename: '德州扑克小绿皮书.pdf',
    },
    {
        title: '德扑蓝皮书',
        cardId: 'learning-book-blue-book-zh',
        path: '/book/德扑蓝皮书.pdf',
        filename: '德扑蓝皮书.pdf',
    },
];

for (const book of books) {
    test(`LEARNING-002: 实际下载《${book.title}》中文版 PDF`, async ({ page }) => {
        const card = page.getByTestId(book.cardId);
        const link = card.getByTestId('learning-download-link');
        let download;

        await test.step('打开中文学习页并定位对应书籍', async () => {
            await page.goto('/learning?lang=zh', { waitUntil: 'domcontentloaded' });
            await expect(page.getByTestId('learning-page')).toHaveCount(1);
            // 当前书籍卡片尚无唯一标识；补齐后继续使用卡片内原有的下载 test ID。
            await expect(card, `ISSUE-004：书籍《${book.title}》缺少唯一卡片 test ID ${book.cardId}`).toHaveCount(1);
            await expect(card).toBeVisible();
            await expect(card).toContainText(book.title);
            await expect(link).toHaveCount(1);
            await expect(link).toBeVisible();
            expect(decodeURI(await link.getAttribute('href'))).toBe(book.path);
            await expect(link).toHaveAttribute('download', book.filename);
        });

        await test.step('真实点击下载并等待文件完成', async () => {
            const downloadStarted = page.waitForEvent('download');
            await link.click();
            download = await downloadStarted;
            expect(download.suggestedFilename()).toBe(book.filename);
            expect(decodeURI(new URL(download.url()).pathname)).toBe(book.path);
            expect(await download.failure(), '浏览器下载应成功完成').toBeNull();
        });

        await test.step('检查实际下载文件的 PDF 签名和结束标记', async () => {
            const filePath = await download.path();
            expect(filePath).not.toBeNull();
            const fileSize = (await stat(filePath)).size;
            expect(fileSize).toBeGreaterThan(1024);

            // 只读取文件首尾，避免把数十 MB 的整本书读入内存或写入 CI 报告。
            const file = await open(filePath, 'r');
            try {
                const header = Buffer.alloc(5);
                await file.read(header, 0, header.length, 0);
                expect(header.toString('ascii')).toBe('%PDF-');
                const tailLength = Math.min(fileSize, 2048);
                const tail = Buffer.alloc(tailLength);
                await file.read(tail, 0, tail.length, fileSize - tailLength);
                expect(tail.toString('ascii')).toContain('%%EOF');
            } finally {
                await file.close();
            }
        });
    });
}
