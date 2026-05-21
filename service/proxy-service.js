const axios = require('axios');
const {HttpsProxyAgent} = require('https-proxy-agent');
const pLimit = require('p-limit');

const username = process.env.PROXY_USERNAME;
const password = process.env.PROXY_PASSWORD;
const proxy = process.env.PROXY;

const DOMAIN_CONCURRENCY = 5;
const COUNTRY_CONCURRENCY = 3;
const RETRY_STATUSES = new Set([502, 503, 429, 522]);
const BACKOFF_DELAYS = [1000, 3000, 5000, 10000, 15000];
const RETRYABLE_ERRORS = ['EPROTO', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ERR_CANCELED', 'EAI_AGAIN'];


class Proxy {

    constructor() {
        this.stats = { domains: 0, requests: 0, bytes: 0 };
    }

    resetStats() {
        this.stats = { domains: 0, requests: 0, bytes: 0 };
    }

    getDelay(attempt, status) {
        if (status === 401) return 1000 + attempt * 1000;
        if (RETRY_STATUSES.has(status)) {
            return BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)] * 2;
        }
        return BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
    }

    createAgent(iso) {
        const sessId = `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
        const proxyUrl = `http://${username}-cc-${iso}-sessid-${sessId}-sesstime-5:${password}@${proxy}`;
        return new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    }

    async tryRequest(url, agent, maxRetries = 5, iso = null) {
        let currentAgent = agent;
        for (let count = 0; count < maxRetries; count++) {
            const controller = new AbortController();
            const hardTimeout = setTimeout(() => controller.abort(), 45000);
            try {
                this.stats.requests++;
                const response = await axios(url, {
                    httpsAgent: currentAgent,
                    timeout: 30000,
                    signal: controller.signal,
                    decompress: false,
                    responseType: 'arraybuffer',
                    headers: {
                        'Accept': 'text/html',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    }
                });
                this.stats.bytes += response.data.byteLength || 0;
                if (response.status >= 200 && response.status < 300) {
                    return;
                }
            } catch (error) {
                const status = error.response?.status;
                if (error.response && error.response.data) {
                    this.stats.bytes += error.response.data.byteLength || 0;
                }

                const isRetryableNetwork = !error.response && RETRYABLE_ERRORS.some(code => error.code === code || error.message?.includes(code));
                const isRetryableStatus = RETRY_STATUSES.has(status);
                const shouldRotate = iso && (isRetryableStatus || isRetryableNetwork);

                if (count === maxRetries - 1) {
                    const issue = error.code === 'ERR_CANCELED'
                        ? 'timeout of 45000ms exceeded'
                        : (error.response ? `Request failed with status code ${status}` : error.message || "Request failed");
                    const finalStatus = status || 522;
                    console.log({ url, attempt: count + 1, status: finalStatus, issue });
                    return { status: finalStatus, issue };
                }

                if (shouldRotate) {
                    currentAgent = this.createAgent(iso);
                    console.log(`[retry ${count + 1}/${maxRetries}] ${url} — ${status || error.code || 'network error'}, rotating session, wait ${this.getDelay(count, status || 522)}ms`);
                } else {
                    console.log(`[retry ${count + 1}/${maxRetries}] ${url} — status ${status || 'N/A'}, wait ${this.getDelay(count, status)}ms`);
                }

                const delay = this.getDelay(count, status);
                await new Promise(r => setTimeout(r, delay));
            } finally {
                clearTimeout(hardTimeout);
            }
        }
    }


    async createJob(scrapList) {
        this.resetStats();
        try {
            const countryLimit = pLimit(COUNTRY_CONCURRENCY);
            const domainLimit = pLimit(DOMAIN_CONCURRENCY);

            const scrapPromises = scrapList.map((scrap) => countryLimit(async () => {
                const agent = this.createAgent(scrap.iso);

                const domainPromises = scrap.domains.map((domain) => domainLimit(async () => {
                    this.stats.domains++;
                    const dom = domain.replace(/^https:\/\//, '');
                    const error = await this.tryRequest(`https://${dom}`, agent, 5, scrap.iso);
                    if (error) {
                        return {
                            ...error,
                            country: scrap.country,
                            managers: scrap.managers,
                            info: scrap.info,
                            dom: dom,
                            iso: scrap.iso
                        };
                    }
                    return null;
                }));

                const results = await Promise.all(domainPromises);
                return results.filter(Boolean);
            }));

            const firstPassResults = await Promise.all(scrapPromises);
            const allErrors = firstPassResults.flat();

            const retryable = allErrors.filter(e => RETRY_STATUSES.has(e.status));
            if (!retryable.length) return allErrors;

            console.log(`[second pass] Retrying ${retryable.length} domains with 502/503/429 after 30s...`);
            await new Promise(r => setTimeout(r, 30000));

            const secondPassResults = [];
            for (const item of retryable) {
                const iso = item.iso || scrapList.find(s => s.country === item.country)?.iso;
                if (!iso) { secondPassResults.push(item); continue; }

                const agent = this.createAgent(iso);
                const error = await this.tryRequest(`https://${item.dom}`, agent, 3, iso);
                if (error) {
                    secondPassResults.push({ ...item, ...error });
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            const stillRetryable = secondPassResults.filter(e => RETRY_STATUSES.has(e.status));
            if (!stillRetryable.length) {
                const nonRetryable = allErrors.filter(e => !RETRY_STATUSES.has(e.status));
                const passed = secondPassResults.filter(e => !RETRY_STATUSES.has(e.status));
                return [...nonRetryable, ...passed];
            }

            console.log(`[third pass] Retrying ${stillRetryable.length} domains after 60s...`);
            await new Promise(r => setTimeout(r, 60000));

            const thirdPassResults = [];
            for (const item of stillRetryable) {
                const iso = item.iso;
                if (!iso) { thirdPassResults.push(item); continue; }

                const agent = this.createAgent(iso);
                const error = await this.tryRequest(`https://${item.dom}`, agent, 3, iso);
                if (error) {
                    thirdPassResults.push({ ...item, ...error });
                }
                await new Promise(r => setTimeout(r, 3000));
            }

            const nonRetryable = allErrors.filter(e => !RETRY_STATUSES.has(e.status));
            const passedSecond = secondPassResults.filter(e => !RETRY_STATUSES.has(e.status));
            return [...nonRetryable, ...passedSecond, ...thirdPassResults];
        } catch (e) {
            console.log(e);
        }
    }
}

module.exports = new Proxy();

