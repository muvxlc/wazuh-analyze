import http from 'http';

const verdict = {
  summary: "Mock AI Verification",
  confidence: 0.99,
  likelyFalsePositive: false,
  eventType: "authentication_success",
  severity: "critical",
  recommendedActions: ["Block IP"],
  threatIntel: { score: 100, category: "Malware" },
  affectedAsset: { os: "Linux" }
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    console.log(`[Mock AI] Received ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: { content: JSON.stringify(verdict) }
      }]
    }));
  });
});

server.listen(1234, '127.0.0.1', () => {
  console.log('[Mock AI] Listening on http://127.0.0.1:1234');
});
