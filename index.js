require('dotenv').config();
const cron = require('node-cron');
const TelegramService = require('./service/telegram-service')
const HydraProxy = require('./service/proxy-service')
const GoogleDocService = require('./service/google-sheets-service')
const projectsForScan = require('./db')



async function main() {
    try {
        const tasks = projectsForScan.map(async project => {
            if (project.state) {
                const googleSheetData = await GoogleDocService.readSheet(project.docId, project.docRead, 'A:E')
                const telegram = new TelegramService(project.telegramToken, project.chatId);
                const result = await HydraProxy.createJob(googleSheetData)
                if (result.length) {
                    await telegram.messageToTelegram(`Start scanning...🧐`)
                    for (const res of result) {
                        try {
                            console.log(res.managers)
                            await telegram.messageToTelegram(
                                `🚫 <b>Помилка запиту</b> 🚫\n\n` +
                                `<b>🌍 Країна:</b>  ${res.country}\n` +
                                `<b>🌐 Домен:</b>  ${res.dom}\n` +
                                `<b>📄 Помилка:</b>  ${res.issue}\n` +
                                `<b> Менеджери:</b>\n${res.managers.join("\n")}`
                            );
                        } catch (e) {
                            console.log(e)
                        }
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                    await telegram.messageToTelegram(`Scanning is finished ❌`)
                    const trafficMB = (HydraProxy.stats.bytes / 1024 / 1024).toFixed(2);
                    await telegram.messageToTelegram(
                        `📊 <b>Статистика прогону:</b>\n` +
                        `• Доменів перевірено: ${HydraProxy.stats.domains}\n` +
                        `• HTTP запитів: ${HydraProxy.stats.requests}\n` +
                        `• Трафік: ${trafficMB} MB`
                    );
                    const dateTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Kyiv" })
                    const sendToGoogleDoc = result.map((res) => {
                        try {
                            return [
                                res.country,
                                res.dom,
                                res.issue,
                                dateTime
                            ];
                        } catch (e) {
                            console.log(e.error)
                        }
                    })
                    await GoogleDocService.writeToSheet(project.docId, project.docWrite, sendToGoogleDoc, "A:D");
                } else {
                    await telegram.messageToTelegram(`Everything works ✅`)
                    const trafficMB = (HydraProxy.stats.bytes / 1024 / 1024).toFixed(2);
                    await telegram.messageToTelegram(
                        `📊 <b>Статистика прогону:</b>\n` +
                        `• Доменів перевірено: ${HydraProxy.stats.domains}\n` +
                        `• HTTP запитів: ${HydraProxy.stats.requests}\n` +
                        `• Трафік: ${trafficMB} MB`
                    );
                }
            }
        })
        await Promise.all(tasks)
    } catch (e) {
        console.log(e)
    }
}

cron.schedule('0 9,16 * * *', main, {
    timezone: 'Europe/Kyiv'
});

console.log('Scheduler started. Will run at 09:00 and 16:00 Kyiv time.');
