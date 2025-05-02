// Membuat koneksi WebSocket ke server
const ws = new WebSocket(`ws://${window.location.host}`);

const latestAlerts = [];
const archivedAlerts = [];

ws.onmessage = (event) => {
    const alert = JSON.parse(event.data);
    alert.timestamp = alert.timestamp || new Date().toISOString();
    console.log('📥 Received alert:', alert);
    addAlertToLatest(alert);

    if (alert.alert_level >= 7) {
        document.getElementById('alarm-sound').play();
    }
};

function getAlertIcon(level) {
    if (level >= 9) return '🔥';
    if (level >= 7) return '⚠️';
    if (level >= 4) return '🔔';
    return 'ℹ️';
}

function addAlertToLatest(alert) {
    latestAlerts.push(alert);
    latestAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderAlerts(latestAlerts, 'alerts-list');
    setTimeout(() => moveAlertToArchive(alert), 10000);
}

function moveAlertToArchive(alert) {
    const index = latestAlerts.indexOf(alert);
    if (index !== -1) latestAlerts.splice(index, 1);
    archivedAlerts.push(alert);
    archivedAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    renderAlerts(latestAlerts, 'alerts-list');
    renderAlerts(archivedAlerts, 'archive-list');
}

function renderAlerts(alerts, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.classList.add('alert');
        if (alert.alert_level < 4) item.classList.add('low-alert');

        const time = new Date(alert.timestamp).toLocaleTimeString();
        item.innerHTML = `${getAlertIcon(alert.alert_level)} <strong>${alert.agent || 'Unknown Agent'}:</strong> ${alert.description || 'No Description'} <span class="float-end"><em>${time}</em></span>`;

        container.appendChild(item);
    });
}

async function fetchAgentList() {
    try {
        const response = await fetch('/api/agents');
        const agents = await response.json();
        const agentListContainer = document.getElementById('agent-list');
        agents.forEach(agent => {
            const agentItem = document.createElement('li');
            agentItem.textContent = `${agent.name} (ID: ${agent.id})`;
            agentListContainer.appendChild(agentItem);
        });
    } catch (error) {
        console.error('❌ Failed to load agent list:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchAgentList();
    const welcomePopup = document.getElementById('welcome-popup');
    const startButton = document.getElementById('start-btn');

    welcomePopup.style.display = 'flex';
    startButton.addEventListener('click', () => {
        welcomePopup.style.display = 'none';
    });
});
