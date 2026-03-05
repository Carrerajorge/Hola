import http from 'http';

const PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB payload
const largeString = 'a'.repeat(PAYLOAD_SIZE);

const payload = JSON.stringify({
    messages: [{ role: 'user', content: largeString }],
    chatId: "test-massive-context-1234",
    systemPrompt: "You are a helpful assistant."
});

const options = {
    hostname: 'localhost',
    port: 5001,
    path: '/api/chats',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

console.log(`Sending ${PAYLOAD_SIZE / 1024 / 1024}MB payload to localhost:5001/api/chats...`);

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        if (res.statusCode === 413) {
            console.error('FAILED: Payload Too Large (413)');
        } else {
            console.log('SUCCESS: Server accepted the massive payload!');
        }
        console.log(`RESPONSE snippet: \\n${data.substring(0, 150)}`);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request:`, e);
});

req.write(payload);
req.end();
