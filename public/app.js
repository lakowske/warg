class WargClient {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        
        this.initializeElements();
        this.setupEventListeners();
        this.updateTimestamp();
        this.connect();
    }

    initializeElements() {
        // Status indicators
        this.wsStatus = document.getElementById('wsStatus');
        this.browserStatus = document.getElementById('browserStatus');
        this.clientCount = document.getElementById('clientCount');
        
        // Control buttons
        this.startBrowserBtn = document.getElementById('startBrowser');
        this.stopBrowserBtn = document.getElementById('stopBrowser');
        this.restartBrowserBtn = document.getElementById('restartBrowser');
        
        // Navigation
        this.urlInput = document.getElementById('urlInput');
        this.navigateBtn = document.getElementById('navigateBtn');
        this.screenshotBtn = document.getElementById('screenshotBtn');
        this.reloadBtn = document.getElementById('reloadBtn');
        this.backBtn = document.getElementById('backBtn');
        this.forwardBtn = document.getElementById('forwardBtn');
        
        // Commands
        this.clickSelector = document.getElementById('clickSelector');
        this.clickBtn = document.getElementById('clickBtn');
        this.typeSelector = document.getElementById('typeSelector');
        this.typeText = document.getElementById('typeText');
        this.typeBtn = document.getElementById('typeBtn');
        this.jsCode = document.getElementById('jsCode');
        this.executeBtn = document.getElementById('executeBtn');
        
        // Logs
        this.logArea = document.getElementById('logArea');
        this.clearLogsBtn = document.getElementById('clearLogs');
    }

    setupEventListeners() {
        // Browser lifecycle
        this.startBrowserBtn.addEventListener('click', () => this.startBrowser());
        this.stopBrowserBtn.addEventListener('click', () => this.stopBrowser());
        this.restartBrowserBtn.addEventListener('click', () => this.restartBrowser());
        
        // Navigation
        this.navigateBtn.addEventListener('click', () => this.navigate());
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.navigate();
        });
        this.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
        this.reloadBtn.addEventListener('click', () => this.reload());
        this.backBtn.addEventListener('click', () => this.goBack());
        this.forwardBtn.addEventListener('click', () => this.goForward());
        
        // Commands
        this.clickBtn.addEventListener('click', () => this.clickElement());
        this.typeBtn.addEventListener('click', () => this.typeText());
        this.executeBtn.addEventListener('click', () => this.executeJS());
        
        // Clear logs
        this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.log('info', `Connecting to WebSocket: ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.log('success', 'WebSocket connected');
            this.wsStatus.classList.add('connected');
            this.reconnectAttempts = 0;
            this.updateButtonStates();
        };
        
        this.ws.onmessage = (event) => {
            this.handleMessage(JSON.parse(event.data));
        };
        
        this.ws.onclose = () => {
            this.log('error', 'WebSocket disconnected');
            this.wsStatus.classList.remove('connected');
            this.browserStatus.classList.remove('connected');
            this.updateButtonStates();
            this.attemptReconnect();
        };
        
        this.ws.onerror = (error) => {
            this.log('error', `WebSocket error: ${error.message || 'Connection failed'}`);
        };
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.log('info', `Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay);
            
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
        } else {
            this.log('error', 'Max reconnection attempts reached');
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'status':
                this.updateStatus(message.data);
                break;
            case 'browser_started':
                this.log('success', 'Browser started');
                this.browserStatus.classList.add('connected');
                this.updateButtonStates();
                break;
            case 'browser_stopped':
                this.log('info', 'Browser stopped');
                this.browserStatus.classList.remove('connected');
                this.updateButtonStates();
                break;
            case 'browser_restarted':
                this.log('success', 'Browser restarted');
                this.browserStatus.classList.add('connected');
                this.updateButtonStates();
                break;
            case 'command_result':
                this.handleCommandResult(message.data);
                break;
            case 'command_executed':
                this.log('info', `Command executed by another client: ${message.data.command}`);
                break;
            case 'error':
                this.log('error', message.error || 'Unknown error');
                break;
            default:
                this.log('info', `Unknown message type: ${message.type}`);
        }
    }

    updateStatus(status) {
        if (status.initialized) {
            this.browserStatus.classList.add('connected');
        } else {
            this.browserStatus.classList.remove('connected');
        }
        
        this.clientCount.textContent = `Clients: ${status.connectedClients || 0}`;
        
        if (status.pageInfo) {
            this.log('info', `Page: ${status.pageInfo.title} (${status.pageInfo.url})`);
        }
        
        this.updateButtonStates();
    }

    updateButtonStates() {
        const wsConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
        const browserRunning = this.browserStatus.classList.contains('connected');
        
        // Browser lifecycle buttons
        this.startBrowserBtn.disabled = !wsConnected || browserRunning;
        this.stopBrowserBtn.disabled = !wsConnected || !browserRunning;
        this.restartBrowserBtn.disabled = !wsConnected;
        
        // Command buttons
        const commandButtons = [
            this.navigateBtn, this.screenshotBtn, this.reloadBtn,
            this.backBtn, this.forwardBtn, this.clickBtn, 
            this.typeBtn, this.executeBtn
        ];
        
        commandButtons.forEach(btn => {
            btn.disabled = !wsConnected || !browserRunning;
        });
    }

    sendMessage(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = { type, data, id: Date.now().toString() };
            this.ws.send(JSON.stringify(message));
            return message.id;
        } else {
            this.log('error', 'WebSocket not connected');
            return null;
        }
    }

    // Browser lifecycle methods
    startBrowser() {
        this.log('info', 'Starting browser...');
        this.sendMessage('browser_start');
    }

    stopBrowser() {
        this.log('info', 'Stopping browser...');
        this.sendMessage('browser_stop');
    }

    restartBrowser() {
        this.log('info', 'Restarting browser...');
        this.sendMessage('browser_stop');
        setTimeout(() => {
            this.sendMessage('browser_start');
        }, 1000);
    }

    // Navigation methods
    navigate() {
        const url = this.urlInput.value.trim();
        if (!url) {
            this.log('error', 'Please enter a URL');
            return;
        }
        
        this.log('info', `Navigating to: ${url}`);
        this.sendMessage('command', {
            type: 'navigate',
            data: { url }
        });
    }

    takeScreenshot() {
        this.log('info', 'Taking screenshot...');
        this.sendMessage('command', {
            type: 'screenshot',
            data: { fullPage: false }
        });
    }

    reload() {
        this.log('info', 'Reloading page...');
        this.sendMessage('command', { type: 'reload' });
    }

    goBack() {
        this.log('info', 'Going back...');
        this.sendMessage('command', { type: 'back' });
    }

    goForward() {
        this.log('info', 'Going forward...');
        this.sendMessage('command', { type: 'forward' });
    }

    // Element interaction methods
    clickElement() {
        const selector = this.clickSelector.value.trim();
        if (!selector) {
            this.log('error', 'Please enter a CSS selector');
            return;
        }
        
        this.log('info', `Clicking element: ${selector}`);
        this.sendMessage('command', {
            type: 'click',
            data: { selector }
        });
    }

    typeText() {
        const selector = this.typeSelector.value.trim();
        const text = this.typeText.value;
        
        if (!selector) {
            this.log('error', 'Please enter a CSS selector');
            return;
        }
        
        this.log('info', `Typing "${text}" into: ${selector}`);
        this.sendMessage('command', {
            type: 'type',
            data: { selector, text }
        });
    }

    executeJS() {
        const script = this.jsCode.value.trim();
        if (!script) {
            this.log('error', 'Please enter JavaScript code');
            return;
        }
        
        this.log('info', 'Executing JavaScript...');
        this.sendMessage('command', {
            type: 'evaluate',
            data: { script }
        });
    }

    handleCommandResult(result) {
        if (result.success) {
            this.log('success', 'Command executed successfully');
            
            if (result.data) {
                if (result.data.screenshot) {
                    this.displayScreenshot(result.data.screenshot);
                } else if (result.data.result !== undefined) {
                    this.log('info', `Result: ${JSON.stringify(result.data.result)}`);
                } else if (result.data.url) {
                    this.log('info', `Current URL: ${result.data.url}`);
                }
            }
        } else {
            this.log('error', `Command failed: ${result.error}`);
        }
    }

    displayScreenshot(base64Image) {
        // Remove existing screenshot
        const existingScreenshot = document.querySelector('.screenshot-container');
        if (existingScreenshot) {
            existingScreenshot.remove();
        }
        
        // Create new screenshot container
        const container = document.createElement('div');
        container.className = 'screenshot-container';
        
        const img = document.createElement('img');
        img.src = `data:image/png;base64,${base64Image}`;
        img.alt = 'Browser Screenshot';
        
        container.appendChild(img);
        this.logArea.appendChild(container);
        
        // Scroll to bottom
        this.logArea.scrollTop = this.logArea.scrollHeight;
    }

    log(type, message) {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        
        const timestamp = document.createElement('div');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = new Date().toLocaleTimeString();
        
        const content = document.createElement('div');
        content.textContent = message;
        
        entry.appendChild(timestamp);
        entry.appendChild(content);
        
        this.logArea.appendChild(entry);
        this.logArea.scrollTop = this.logArea.scrollHeight;
    }

    clearLogs() {
        this.logArea.innerHTML = '';
        this.log('info', 'Logs cleared');
    }

    updateTimestamp() {
        const startTime = document.getElementById('startTime');
        if (startTime) {
            startTime.textContent = new Date().toLocaleTimeString();
        }
    }
}

// Initialize the client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WargClient();
});