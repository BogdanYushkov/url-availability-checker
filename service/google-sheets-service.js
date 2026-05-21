const {google} = require('googleapis');

const google_cred = {
    type: "service_account",
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/^"|"$/g, '').replace(/\\n/g, '\n') : null,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
    universe_domain: process.env.UNIVERSE_DOMAIN
}


class GoogleDocService {
    constructor() {
        this.auth = new google.auth.GoogleAuth({
            credentials: google_cred,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    }

    async authFun() {
        const authClient = await this.auth.getClient();
        return google.sheets({version: 'v4', auth: authClient})
    }

    async getSheetNameByGid(spreadsheetId, gid, sheets) {
        const response = await sheets.spreadsheets.get({spreadsheetId});
        const sheet = response.data.sheets.find(
            s => s.properties.sheetId.toString() === gid.toString()
        );
        if (!sheet) {
            throw new Error(`Аркуш з gid=${gid} не знайдено`);
        }
        return sheet.properties.title;
    }

    async writeToSheet(spreadsheetId, sheetGid, values, range) {
        try {
            const sheets = await this.authFun()
            const sheetName = await this.getSheetNameByGid(spreadsheetId, sheetGid, sheets);
            return await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${sheetName}!${range}`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: {
                    values,
                },
            })
        } catch (error) {
            console.error('Помилка при записі в Google Sheet:', error.message);
        }
    }


    async readSheet(spreadsheetId, sheetGid, range) {
        try {
            const scrapList = []
            const sheets = await this.authFun()
            const sheetName = await this.getSheetNameByGid(spreadsheetId, sheetGid, sheets);
            const response = await sheets.spreadsheets.values.get({spreadsheetId, range: `${sheetName}!${range}`});
            const result = response.data.values
            result.shift()
            result.forEach(item => {
                scrapList.push({
                    country: item[0].charAt(0).toUpperCase() + item[0].slice(1),
                    iso: item[1].toLowerCase(),
                    domains: item[2].split(",").map(i => i.trim()),
                    managers: item[3].split(",").map(i => i.trim()),
                    info: item[4] ? item[4] : ''
                });
            });
            return scrapList;
        } catch (error) {
            console.error("Сталася помилка:", error.message);
        }
    }
}

module.exports = new GoogleDocService();