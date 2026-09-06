const fs = require('fs/promises');
const fss = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');
const { request } = require('undici');

const stream_pipeline = promisify(pipeline);

const default_options = {
    headers_timeout: 30000,
    body_timeout: 30000,
    max_redirections: 10,
};

function request_options(options = {}) {
    return {
        headersTimeout:
            options.headers_timeout || default_options.headers_timeout,
        bodyTimeout: options.body_timeout || default_options.body_timeout,
        maxRedirections:
            options.max_redirections || default_options.max_redirections,
    };
}

async function assert_success(status_code, url, body) {
    if (status_code >= 200 && status_code < 300) return;

    await body.dump();
    throw new Error(`HTTP ${status_code} while downloading ${url}`);
}

async function get_text(url, options = {}) {
    const response = await request(url, request_options(options));
    await assert_success(response.statusCode, url, response.body);
    return response.body.text();
}

async function download_once(url, destination, options) {
    const response = await request(url, request_options(options));
    await assert_success(response.statusCode, url, response.body);

    await stream_pipeline(
        response.body,
        fss.createWriteStream(destination, { flags: 'w' })
    );

    const expected_size = Number(response.headers['content-length']);
    if (Number.isSafeInteger(expected_size)) {
        const { size } = await fs.stat(destination);
        if (size !== expected_size) {
            throw new Error(
                `Incomplete download from ${url}: expected ${expected_size} bytes, got ${size}`
            );
        }
    }
}

async function download_file(url, destination, options = {}) {
    const retries = options.retries === undefined ? 2 : options.retries;
    let last_error;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await download_once(url, destination, options);
            return;
        } catch (error) {
            last_error = error;
            await fs.rm(destination, { force: true });

            if (attempt < retries) {
                await new Promise(resolve =>
                    setTimeout(resolve, 250 * Math.pow(2, attempt))
                );
            }
        }
    }

    throw new Error(
        `Failed to download ${url} after ${retries + 1} attempts: ${
            last_error.message
        }`
    );
}

module.exports = {
    download_file,
    get_text,
};
