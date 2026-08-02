// const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');

// === Konfigurasi ===
const WAZUH_API_URL = process.env.WAZUH_API_URL;
const WAZUH_USER = process.env.WAZUH_USER;
const WAZUH_PASSWORD = process.env.WAZUH_PASSWORD;

if (!WAZUH_API_URL || !WAZUH_USER || !WAZUH_PASSWORD) {
  throw new Error('WAZUH_API_URL, WAZUH_USER, and WAZUH_PASSWORD are required');
}

// const SSL_OPTIONS = {
//   key: fs.readFileSync(path.join(__dirname, 'certs/server-key.pem')),
//   cert: fs.readFileSync(path.join(__dirname, 'certs/server-cert.pem'))
// };

const app = express();
// const server = https.createServer(SSL_OPTIONS, app);
const server = http.createServer(app);
// const PORT = 443;
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

let clients = [];
let latestAlerts = [];

// ====== WebSocket Server (hanya 1, via HTTPS / wss://) ======
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('🔌 WebSocket client connected');
  clients.push(ws);

  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
    console.log('❌ WebSocket client disconnected');
  });
});

function broadcastAlert(alert) {
  const message = JSON.stringify(alert);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

async function getWazuhToken() {
  try {
    const res = await axios.post(`${WAZUH_API_URL}/security/user/authenticate?raw=true`, {}, {
      auth: {
        username: WAZUH_USER,
        password: WAZUH_PASSWORD
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    return res.data;
  } catch (err) {
    console.error('❌ Failed to get Wazuh token:', err.message);
    return null;
  }
}

async function fetchAgentList(token) {
  try {
    const res = await axios.get(`${WAZUH_API_URL}/agents`, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    return res.data.data?.affected_items || [];
  } catch (err) {
    console.error('❌ Failed to fetch Wazuh agents:', err.message);
    return [];
  }
}

// ====== Endpoints ======
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/api/agents', async (req, res) => {
  const token = await getWazuhToken();
  if (!token) return res.status(500).send('Failed to get token');

  const agents = await fetchAgentList(token);
  res.json(agents);
});

app.get('/api/latest-alerts', (req, res) => {
  res.json(latestAlerts);
});

app.post('/api/alerts', (req, res) => {
  const alert = req.body;
  if (!alert) {
    console.error('❌ Received empty alert body');
    return res.status(400).send('Empty alert');
  }

  console.log('📥 Received alert via /api/alerts:', alert);
  latestAlerts.unshift(alert);
  if (latestAlerts.length > 20) latestAlerts.pop();
  broadcastAlert(alert);
  res.status(200).send('Alert received');
});

// app.post('/api/alerts', (req, res) => {
//   const alert = req.body;
//   console.log('📥 Received alert via /api/alerts:', alert);
//   latestAlerts.unshift(alert);
//   if (latestAlerts.length > 20) latestAlerts.pop();
//   broadcastAlert(alert);
//   res.status(200).send('Alert received');
// });

// ====== Start Server ======
server.listen(PORT, () => {
  console.log(`🌐 Web dashboard running at https://localhost:${PORT}`);
  console.log(`📡 WebSocket running at wss://localhost:${PORT}`);
});
