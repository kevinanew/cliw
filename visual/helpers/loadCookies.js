const fs = require('fs');

module.exports = async (browserContext, scenario) => {
    let cookies = [];
    const { cookiePath } = scenario;

    if (cookiePath && fs.existsSync(cookiePath)) {
        cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
    }

    if (cookies.length > 0) {
        await browserContext.addCookies(cookies);
    }
};
