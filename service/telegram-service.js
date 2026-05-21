const axios = require("axios");

class TelegramService {
    constructor(botToken, chatId) {
        this.botToken = botToken
        this.chatId = chatId
    }

    async messageToTelegram(text) {
        try {
            const data = {
                chat_id: this.chatId,
                text: text,
                parse_mode: 'HTML'
            };
            await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, data);
        } catch (e) {
            throw e;
        }
    }
}

module.exports = TelegramService;