const https = require('https');
const key = process.env.OPENAI_API_KEY || "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";

const req = https.request('https://api.openai.com/v1/models', {
  headers: {
    'Authorization': 'Bearer ' + key
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', data));
});
req.end();
