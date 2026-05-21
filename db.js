module.exports = [
    {
        "title": "Demo Project",
        "docId": process.env.GOOGLE_SHEET_ID || "YOUR_GOOGLE_SHEET_ID",
        "docRead": "0",
        "docWrite": process.env.GOOGLE_SHEET_WRITE_GID || "0",
        "telegramToken": process.env.TELEGRAM_BOT_TOKEN,
        "chatId": process.env.TELEGRAM_CHAT_ID,
        "state": true
    },

]