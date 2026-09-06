const assert = require('assert').strict;
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { download_file, get_text } = require('../src/http');

const payload = Buffer.from('complete package contents');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
    });
}

async function main() {
    const test_directory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'piston-http-test-')
    );
    let retry_requests = 0;

    const server = http.createServer((request, response) => {
        if (request.url === '/text') {
            response.writeHead(200, {
                'Content-Length': payload.length,
            });
            response.end(payload);
            return;
        }

        if (request.url === '/retry') {
            retry_requests++;
            response.writeHead(200, {
                'Content-Length': payload.length,
            });

            if (retry_requests === 1) {
                response.write(payload.subarray(0, 5));
                response.socket.destroy();
            } else {
                response.end(payload);
            }
            return;
        }

        response.writeHead(404);
        response.end();
    });

    await listen(server);
    const { port } = server.address();
    const base_url = `http://127.0.0.1:${port}`;

    try {
        assert.equal(await get_text(`${base_url}/text`), payload.toString());

        const destination = path.join(test_directory, 'package.tar.gz');
        await download_file(`${base_url}/retry`, destination, {
            body_timeout: 1000,
            retries: 1,
        });

        assert.deepEqual(await fs.readFile(destination), payload);
        assert.equal(retry_requests, 2);

        await assert.rejects(
            download_file(`${base_url}/missing`, destination, { retries: 0 }),
            /HTTP 404/
        );
    } finally {
        await close(server);
        await fs.rm(test_directory, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
