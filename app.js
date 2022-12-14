const express = require('express');
const jsonParser = express.json();
const fs = require('fs');
const app = express();
const puppeteer = require('puppeteer-extra');
const cheerio = require('cheerio');
const port = process.env.PORT || 8080;
const path = require('path');
//const jsonStream = require('JSONStream');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());


const downloadPath = path.resolve('./download');
const mpstatsCookies = 'mpstats-cookies.json';

app.get('/', async function (req, res) {
    console.log(req.query)

    if (req.query.wbQuery) {
        let url = `https://www.wildberries.ru/catalog/0/search.aspx?sort=popular&search=${encodeURIComponent(req.query.wbQuery)}`;
        console.log(`url: ${url}`)

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins',
                '--disable-site-isolation-trials'
            ]
        });

        try {
            const page = await browser.newPage();
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
            });

            await page.waitForSelector('.j-card-item');

            let skus = await page.evaluate(() => {
                let result = Array.from(document.body.querySelectorAll('.j-card-item'), (el, i) => `[${i + 1}, ${el.dataset.popupNmId}]`)
                    .slice(0, 100).join();
                return `[${result}]`;
            });

            res.send(skus);
        } catch (e) {
            console.log(e.message);
            res.send("Something went wrong");
        }

        await browser.close();
    }
});


app.get('/wb/rating/:sku', async function (req, res) {
    console.log(req.query);

    const dateParts = req.query.d.split('-');

    const date = new Date(dateParts[0], +dateParts[1] - 1, dateParts[2]);
    const dayBefore = date;
    dayBefore.setDate(dayBefore.getDate() - 1);

    const url = `https://www.wildberries.ru/catalog/${req.params.sku}/feedbacks`;
    console.log(`url: ${url}`)

    const browser = await newBrowserLaunch(!req.query.hl);
    const page = (await browser.pages())[0];
    await configurePage(page);

    try {
        console.log("going to url");
        await page.goto(url, {waitUntil: 'networkidle2'});
        console.log("after goto")

        let $ = cheerio.load(await page.evaluate(() => document.body.innerHTML));
        console.log("body loaded");

        const commentsCountSelector = '#app > div:nth-child(5) > div > section > div.product-feedbacks__main > div.product-feedbacks__header.hide-mobile > h1 > span';
        const ratingSelector = '#app > div:nth-child(5) > div > section > div.product-feedbacks__side > div > div.rating-product__header > div > b';

        const data = {
            feedbacksCount: 0,
            rating: "-",
            feedbacks: []
        };

        data.feedbacksCount = $(commentsCountSelector).text();

        if (data.feedbacksCount === "0") {
            await browser.close()
            return res.send(JSON.stringify(data));
        }

        data.rating = $(ratingSelector).text();

        //////
        let isPrevDayReached = false;
        let feedbacksCount;

        const months = {
            "????????????": 1, "??????????????": 2, "??????????": 3, "????????????": 4, "??????": 5, "????????": 6, "????????": 7,
            "??????????????": 8, "????????????????": 9, "??????????????": 10, "????????????": 11, "??????????????": 12
        };

        while (true) {
            data.feedbacks = [];

            $(`div.feedback__info`).map((i, v) =>
                data.feedbacks.push({
                    date: $(v).children('span').text(),
                    rate: $(v).children('div').children('span:nth-child(1)').attr().class.match(/star\d/i)[0].match(/\d/)[0]
                }));

            data.feedbacks = data.feedbacks.map(v => {
                let dateSplit = v.date.split(/\s/).filter(v => v);
                let feedbackDate;

                if (dateSplit.length === 2) {
                    let curDate = new Date();
                    if (dateSplit[0] === "??????????????,") {
                        feedbackDate = `${curDate.getDate()}.${`${curDate.getMonth() + 1}`.padStart(2, '0')}.${curDate.getFullYear()}`;
                    } else if (dateSplit[0] === "??????????,") {
                        let yesterday = curDate;
                        yesterday.setDate(yesterday.getDate() - 1);
                        feedbackDate = `${yesterday.getDate()}.${`${curDate.getMonth() + 1}`.padStart(2, '0')}.${yesterday.getFullYear()}`;
                    }
                } else {
                    feedbackDate = `${dateSplit[0]}.${`${months[dateSplit[1].replace(",", "")]}`.padStart(2, '0')}.${new Date().getFullYear()}`;
                }

                const parts = feedbackDate.split('.');
                if (+parts[2] < dayBefore.getFullYear()
                    || (+parts[2] === dayBefore.getFullYear() && +parts[1] < (dayBefore.getMonth() + 1))
                    || +parts[2] === dayBefore.getFullYear() && +parts[1] === (dayBefore.getMonth() + 1) && +parts[0] <= dayBefore.getDate()) {
                    isPrevDayReached = true;
                }

                return {
                    date: feedbackDate,
                    rate: v.rate
                };
            });

            feedbacksCount = data.feedbacks.length;

            if (isPrevDayReached)
                break;
            console.log("scrolling");
            await page.evaluate(async () => {
                window.scrollBy(0, 5000);
            });

            await sleep(2000);

            $ = cheerio.load(await page.evaluate(() => document.body.innerHTML));

            if ($(`div.feedback__info`).length === feedbacksCount) {
                break;
            }
        }

        res.send(JSON.stringify(data));
        console.log("response sent");
    } catch (e) {
        console.log(e.message);
        res.send("Something went wrong");
    }

    await browser.close();
});

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            let distance = 100;
            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}


app.get("/ozon", async function (req, res) {
    console.log(req.query);
    if (req.query.sku) {
        console.log(req.query.sku);
        let url = `https://ozon.ru/context/detail/id/${req.query.sku}`;

        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log("?????????????? ??????????????");
        try {
            /*,
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins',
                    '--disable-site-isolation-trials'*/

            const page = await browser.newPage();

            if (fs.existsSync('oz-cookies.json')) {
                let cookies = fs.readFileSync('oz-cookies.json', 'utf8')
                const deserializedCookies = JSON.parse(cookies)
                await page.setCookie(...deserializedCookies)
            }

            console.log("???????????????? ??????????????");
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
            });
            console.log("?????????? goto");

            try {
                await page.waitForSelector('div#section-characteristics', {
                    timeout: 10000
                });
            } catch (e) {
                res.send("Can't get data");
                await browser.close();
                return;
            }

            console.log("?????????? ???????????????? ??????????????????");
            let body = await page.evaluate(() => document.body.innerHTML);
            console.log("?????????? ????????");

            const $ = cheerio.load(body);

            let nodes = $('.l3r').get().map(ele => {
                return {
                    attr: $(ele).find('.r2l').text(),
                    value: $(ele).find('dd[class="rl2"]').text()
                }
            });

            console.log(JSON.stringify(nodes));

            res.send(JSON.stringify(nodes));

            let cookies = await page.cookies()
            const cookieJson = JSON.stringify(cookies)

            fs.writeFileSync('oz-cookies.json', cookieJson)
        } catch (e) {
            console.log(e.message);
            res.send("Something went wrong");
        }

        await browser.close();

        console.log('after result');
    } else {
        res.send("Arguments is empty");
    }
});

app.get("/ozon/rating", async function (req, res) {
    const commentsHref = '#layoutPage > div.a7 > div.container.b0 > div:nth-child(2) > div > div > div.x6m.x8m.xm9.my1 > div > div.x6m.xm9.my1 > div:nth-child(1) > div > div > div._4-a > a';

    console.log(req.query);
    if (req.query.sku) {
        console.log(req.query.sku);
        let url = `https://ozon.ru/context/detail/id/${req.query.sku}/?oos_search=false`;

        let browser = await newBrowserLaunch(!req.query.hl);
        console.log("browser started");

        let page = (await browser.pages())[0];
        await configurePage(page);
        console.log("page configured");
        //await loadCookies('oz-cookies.json', page);
        try {

            console.log("going to url");
            await page.goto(url, {waitUntil: 'networkidle2'});
            console.log("after goto")

            //await page.waitForTimeout(2000);
            await page.waitForSelector(commentsHref, {timeout: 5000});
            console.log("after waitFor");

            let $ = cheerio.load(await page.evaluate(() => document.body.innerHTML));
            console.log("body loaded");

            let href = $(commentsHref).attr().href;

            // next page

            console.log('restarting browser');
            await browser.close();
            browser = await newBrowserLaunch(!req.query.headless);
            page = (await browser.pages())[0];
            configurePage(page);
            console.log('page configured');
            //await loadCookies('oz-cookies.json', page);

            console.log('going to comments page');
            await page.goto(`https://ozon.ru${href}`, {waitUntil: 'networkidle2'});
            console.log("after goto");

            $ = cheerio.load(await page.evaluate(() => document.body.innerHTML));
            console.log("body ??????????????????");

            // parsing

            let data = {};

            data.comments = $('#comments > div').text().split(/\s/).filter(v => v)[0];
            data.rating = $(`#layoutPage > div.a7 > div.rd4 > div > div.container.b0 > div:nth-child(5) > div > div:nth-child(3) > div.c8.c3 > div:nth-child(1) > div > div > div.aac9 > div.aa9c > span`)
                .text().split(' ')[0];
            data.reviews = [];

            $(`div.v8y`).map((i, v) =>
                data.reviews.push({
                    date: $(v).children(`div.y8v`).text(),
                    rate: $(v).children('div').children('div').children('div:nth-child(2)').attr().style
                }));

            const months = {
                "????????????": 1, "??????????????": 2, "??????????": 3, "????????????": 4, "??????": 5, "????????": 6, "????????": 7,
                "??????????????": 8, "????????????????": 9, "??????????????": 10, "????????????": 11, "??????????????": 12
            };

            const rates = {"width:100%;": 5, "width:80%;": 4, "width:60%;": 3, "width:40%;": 2, "width:20%;": 1};

            data.reviews = data.reviews.map(v => {
                let dateSplit = v.date.split(/\s/).filter(v => v);
                return {
                    date: `${dateSplit[0]}.${months[dateSplit[1]]}.${dateSplit[2]}`,
                    rate: rates[v.rate] ?? 0
                };
            });

            res.send(JSON.stringify(data));

            let cookies = await page.cookies()
            const cookieJson = JSON.stringify(cookies)
            fs.writeFileSync('oz-cookies.json', cookieJson)
        } catch (e) {
            console.log(e.message);
            //res.send("Something went wrong");
            res.send(await page.evaluate(() => document.body.innerHTML));
        }

        await browser.close();

        console.log('after result');
    } else {
        res.send("Arguments is empty");
    }
});


app.get('/mpstats/api/wb/get/item/:sku/sales', async function (req, res) {
    try {
        const sku = req.params.sku;
        const d1 = req.query.d1;
        const d2 = req.query.d2;

        let response = await fetch(`https://mpstats.io/api/wb/get/item/${sku}/sales?d1=${d1}&d2=${d2}`, {
            headers: {
                'Content-Type': 'application/json',
                'X-Mpstats-TOKEN': '62e010f690d6f6.72414271c10c7a6b8873f0b809951a51ebf31e69'
            }
        })
        let result = await response.text();

        console.log(`Response received`);

        res.send(result);
    } catch (e) {
        console.log(e.message)
        res.send('Something went wrong');
    }
});

app.post('/mpstats/api-get/', jsonParser, async function (req, res) {
    try {
        if (!req.body) return res.sendStatus(400)

        console.log(JSON.stringify(req.body));
        console.log(`https://mpstats.io/api/${req.body.url}`);

        let response = await fetch(`https://mpstats.io/api/${req.body.url}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Mpstats-TOKEN': '62e010f690d6f6.72414271c10c7a6b8873f0b809951a51ebf31e69'
            }
        });

        let result = await response.text();
        console.log(`Response recieved`);

        res.send(result);
    } catch (e) {
        console.log(e.message)
        res.send('Something went wrong');
    }

});

app.post('/mpstats/api-get/keywords-multiple', jsonParser, async function (req, res) {
    try {
        if (!req.body) return res.sendStatus(400)

        console.log('Keywords multiple')

        let requests = req.body.skus.map(sku =>
            fetch(`https://mpstats.io/api/${req.body.mp}/get/item/${sku}/by_keywords?d1=${req.body.d1}&d2=${req.body.d2}&full=true`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Mpstats-TOKEN': '62e010f690d6f6.72414271c10c7a6b8873f0b809951a51ebf31e69'
                }
            }));
        console.log("await fetch");
        let responses = await Promise.all(requests);
        let errors = responses.filter((response) => !response.ok);

        if (errors.length > 0) {
            throw errors.map((response) => Error(response.statusText));
        }

        let json = responses.map((response) => response.json());

        console.log("await json");
        let data = await Promise.all(json);

        /*let stream = jsonStream.stringify();
        
        stream.pipe(res);
        
        stream.write(data.map(v => {
            return {words: v.words};
        }));
        
        stream.end();
        */

        res.send(JSON.stringify(data.map(v => {
            return {words: v.words};
        })));
        console.log(`Response sent`);
    } catch (e) {
        console.log(e.message)
        res.send('Something went wrong');
    }
});


app.post('/mpstats/api/', jsonParser, async function (req, res) {
    try {
        if (!req.body) return res.sendStatus(400)

        console.log(JSON.stringify(req.body));
        console.log(`https://mpstats.io/api/${req.body.url}`);

        let response = await fetch(`https://mpstats.io/api/${req.body.url}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mpstats-TOKEN': '62e010f690d6f6.72414271c10c7a6b8873f0b809951a51ebf31e69'
            },
            body: JSON.stringify(req.body.data)
        });

        let result = await response.text();
        console.log(`Response recieved`);

        res.send(result);
    } catch (e) {
        console.log(e.message)
        res.send('Something went wrong');
    }
});

app.get("/mpstats/wb/keywords/:sku", async function (req, res) {

    let url = `https://mpstats.io/wb/keywords/${req.params.sku}`;

    if (req.query.d1 && req.query.d2) {
        url += `?d1=${req.query.d1}&d2=${req.query.d2}`;
    }

    const browser = await puppeteer.launch({
        headless: !req.query.nh,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials'
        ]
    });

    const page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    const headlessUserAgent = await page.evaluate(() => navigator.userAgent);
    const chromeUserAgent = headlessUserAgent.replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(chromeUserAgent);
    await page.setExtraHTTPHeaders({
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    if (fs.existsSync(mpstatsCookies)) {
        console.log("Loading cookies");
        let cookies = fs.readFileSync(mpstatsCookies, 'utf8');
        const deserializedCookies = JSON.parse(cookies);
        await page.setCookie(...deserializedCookies);
    }

    try {
        console.log(`Going to url ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
        });

        console.log("Evaluating first..");
        let body = await page.evaluate(() => document.body.innerHTML);
        let $ = cheerio.load(body);

        // If need to login
        if ($('div.be-error').length ||
            $('a.error-go-tariff-button').length ||
            $('div[class="message"]:contains("?????????????? ???????????? ???????? ??????????????????")').length) {

            if (await logginMpstats(page, body, $)) {
                console.log("Logging success! Saving cookies");
                const cookies = await page.cookies()
                const cookieJson = JSON.stringify(cookies)
                fs.writeFileSync(mpstatsCookies, cookieJson)
            } else {
                console.log("Logging failed");
                res.send("Can't logging");
                await browser.close();
                return;
            }

            console.log("Going to card url..");
            await page.goto(url, {
                waitUntil: 'networkidle2',
            });

            console.log("Evaluating card page..");
            body = await page.evaluate(() => document.body.innerHTML);
            $ = cheerio.load(body);
        }

        console.log("before parsing");
        if (!$(`header:contains("Xlsx ????????????") + ul > li > button`).length) {
            throw "Can't find button";
        }
        const client = await page.target().createCDPSession()
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        })

        clearDownloads();

        //const button = await page.$(`header:contains("Xlsx ????????????")`);
        //const button = await page.$(`header.dropdown-header`);
        //await page.click("#__BVID__82 > ul > li:nth-child(2) > ul > li > button");

        const button = await page.$("#__BVID__82 > ul > li:nth-child(2) > ul > li > button");
        await button.evaluate(b => b.click());

        let timeout = false;
        let timeHandler = setTimeout(() => timeout = true, 10_000);

        let files;
        while (true) {
            files = fs.readdirSync(downloadPath);

            if (files.length && !files[0].includes("crdownload"))
                break;

            if (timeout) throw "download timeout";
        }
        clearTimeout(timeHandler);

        console.log("downloaded");
        console.log(downloadPath);

        const options = {root: downloadPath};

        res.sendFile(files[0], options, function (err) {
            if (err) {
                throw err.message;
            } else {
                console.log('Sent:', files[0]);
            }
        });

    } catch (e) {
        console.log(e.message)
        res.send(e.message);
    }

    await browser.close();
    console.log('Browser closed');
});

app.get('/mpstats', async function (req, res) {

    console.log(req.query)

    if (req.query.sku) {
        console.log(req.query.sku)

        let url = `https://mpstats.io/wb/item/${encodeURIComponent(req.query.sku.toString())}`;

        if (req.query.d1 && req.query.d2)
            url += `?d1=${req.query.d1}&d2=${req.query.d2}`;


        const browser = await puppeteer.launch({
            headless: !req.query.nh,
            args: ['--no-sandbox', '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins',
                '--disable-site-isolation-trials'
            ]
        });

        try {
            const page = await browser.newPage();
            await page.setJavaScriptEnabled(true);
            const headlessUserAgent = await page.evaluate(() => navigator.userAgent);
            const chromeUserAgent = headlessUserAgent.replace('HeadlessChrome', 'Chrome');
            await page.setUserAgent(chromeUserAgent);
            await page.setExtraHTTPHeaders({
                'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
            });

            if (fs.existsSync(mpstatsCookies)) {
                console.log("Loading cookies");
                let cookies = fs.readFileSync(mpstatsCookies, 'utf8');
                const deserializedCookies = JSON.parse(cookies);
                await page.setCookie(...deserializedCookies);
            }

            console.log(`Going to url ${url}`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
            });

            console.log("Evaluating first..");
            let body = await page.evaluate(() => document.body.innerHTML);
            let $ = cheerio.load(body);

            if ($('div.be-error').length || $('a.error-go-tariff-button').length) {
                if (await logginMpstats(page, body, $)) {
                    console.log("Logging success! Saving cookies");
                    const cookies = await page.cookies()
                    const cookieJson = JSON.stringify(cookies)
                    fs.writeFileSync(mpstatsCookies, cookieJson)
                } else {
                    console.log("Logging failed");
                    res.send("Can't logging");
                    await browser.close();
                    return;
                }

                console.log("Going to card url..");
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                });

                console.log("Evaluating card page..");
                body = await page.evaluate(() => document.body.innerHTML);
                $ = cheerio.load(body);
            }

            if ($('div[class="message"]:contains("?????????????? ???????????? ???????? ??????????????????")').length) {
                console.log('Double session Detected')

                if (await logginMpstats(page, body, $)) {
                    console.log("Logging success! Saving cookies");
                    const cookies = await page.cookies()
                    const cookieJson = JSON.stringify(cookies)
                    fs.writeFileSync(mpstatsCookies, cookieJson)
                } else {
                    console.log("Logging failed");
                    res.send("Can't logging");
                    if (browser)
                        await browser.close();
                    return;
                }

                console.log("Going to card url..");
                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                });

                console.log("Evaluating card page..");
                body = await page.evaluate(() => document.body.innerHTML);
                $ = cheerio.load(body);
            }

            if ($('div:contains("???? ???? ???????????? ?????????? ?????????? ???? ???????????? ????????????????????????????")').length) {
                console.log('Sku not find');
                res.send('wrong sku');
                if (browser)
                    await browser.close();
                return;
            }

            if (!$('div.card').length) {
                console.log('Something went wrong (no div.card)')
                res.send('Something went wrong');
                //res.send($.html());    
                if (browser)
                    await browser.close();
                console.log('Browser closed');
                return;
            }

            let data = parseMpstats($);
            let result = JSON.stringify(data);

            //res.send($.html());      
            console.log(result);
            res.send(result);

        } catch (e) {
            console.log(e.message)
            res.send('Something went wrong');
        }

        await browser.close();
        console.log('Browser closed');
    } else {
        res.send("Empty query");
    }
});

app.get("/clearmp", function (req, res) {
    if (fs.existsSync(mpstatsCookies)) {
        fs.unlinkSync(mpstatsCookies);
    }
    console.log("Mpstat cookies cleared");
    res.send("Mpstat cookies cleared");
});

async function logginMpstats(page, body, $) {
    console.log("Going to login page");
    await page.goto("https://mpstats.io/login", {
        waitUntil: 'domcontentloaded',
    });

    await page.type("input[type=email]", "zork.net@gmail.com");
    await page.type("input[type=password]", "sewerrat32167");
    await page.click("form>button.btn");

    console.log("Sign in try..");
    await page.waitForNavigation();

    console.log("Evaluating after loging..");
    body = await page.evaluate(() => document.body.innerHTML);
    $ = cheerio.load(body);

    return !!$('span.user-name').length;
}

function parseMpstats($) {
    let data = {};

    let subjHref = $(`a[title="?????????? ???? ????????????????"]`).attr().href;

    data.subjId = subjHref.substring(subjHref.indexOf('=') + 1);

    // ??????a
    data.price = $(`div:contains("????????") + div > span:first`).text()
    //$(`svg[aria-label="cash stack"]`).parent().next().find('span').first().text()

    // ?????????? ?? ???????????? ????????????????
    data.ransom = $(`div:contains("?? ???????????? ????????????????") + div > span:first`).text()

    // ????????????????
    data.fbo = $(`div:contains("????????????????") + div > span:first`).text()
    //data.fbs = $(`div:contains("????????????????") + div > span:first`).next('span').text();

    // ??????????????????
    data.logistic = $(`div:contains("?????????????? ??????????????????") + div > span:first`).text()

    return data;
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


function clearDownloads() {
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath);
        return;
    }

    const files = fs.readdirSync(downloadPath);
    for (const file of files) {
        fs.unlinkSync(path.join(downloadPath, file));
        console.log(`deleted ${file}`)
    }
}

async function newBrowserLaunch(isHeadless = true) {
    return await puppeteer.launch({
        headless: isHeadless,
        defaultViewport: {
            width: 1690,
            height: 800,
        },
        args: ['--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials']
    });
}

async function configurePage(page) {
    await page.setJavaScriptEnabled(true);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 5.1; rv:5.0) Gecko/20100101 Firefox/5.0');
    await page.setExtraHTTPHeaders({'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'});
    await page.setDefaultNavigationTimeout(0);
}

async function loadCookies(filename, page) {
    if (fs.existsSync(filename)) {
        let cookies = fs.readFileSync(filename, 'utf8');
        const deserializedCookies = JSON.parse(cookies);
        await page.setCookie(...deserializedCookies);
    }
}

app.listen(port, function () {
    console.log('App listening on port ' + port)
})

