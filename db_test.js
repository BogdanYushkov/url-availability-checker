module.exports = [
    {
        "title": "Test Project",
        "docId": process.env.TEST_GOOGLE_SHEET_ID || "YOUR_TEST_GOOGLE_SHEET_ID",
        "docRead": "0",
        "docWrite": process.env.TEST_GOOGLE_SHEET_WRITE_GID || "0",
        "telegramToken": process.env.TEST_TELEGRAM_BOT_TOKEN,
        "chatId": process.env.TEST_TELEGRAM_CHAT_ID,
        "state": true
    },
]