import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import config from './config.js';
import { BrowserManager, BrowserCommand } from './browser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WSMessage {
  type: string;
  data?: any;
  id?: string;
}

class WargServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private browserManager = new BrowserManager();
  private connectedClients = new Set<WebSocket>();

  constructor() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '..', 'public')));
    
    this.app.use((req, _res, next) => {
      logger.info('HTTP request', { 
        method: req.method,
        url: req.url,
        ip: req.ip 
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req, res) => {
      res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        browser: this.browserManager.isInitialized()
      });
    });

    // Browser lifecycle endpoints
    this.app.post('/api/browser/start', async (_req, res) => {
      try {
        await this.browserManager.initialize();
        logger.info('Browser started via API');
        res.json({ success: true, message: 'Browser started' });
        this.broadcastToClients({ type: 'browser_started' });
      } catch (error) {
        logger.error('Failed to start browser via API', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    this.app.delete('/api/browser/stop', async (_req, res) => {
      try {
        await this.browserManager.close();
        logger.info('Browser stopped via API');
        res.json({ success: true, message: 'Browser stopped' });
        this.broadcastToClients({ type: 'browser_stopped' });
      } catch (error) {
        logger.error('Failed to stop browser via API', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    this.app.post('/api/browser/restart', async (_req, res) => {
      try {
        await this.browserManager.close();
        await this.browserManager.initialize();
        logger.info('Browser restarted via API');
        res.json({ success: true, message: 'Browser restarted' });
        this.broadcastToClients({ type: 'browser_restarted' });
      } catch (error) {
        logger.error('Failed to restart browser via API', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Browser command endpoint
    this.app.post('/api/command', async (req, res) => {
      try {
        const command: BrowserCommand = req.body;
        const result = await this.browserManager.executeCommand(command);
        
        logger.info('Command executed via API', { 
          type: command.type,
          success: result.success 
        });

        res.json(result);

        // Broadcast command result to WebSocket clients
        this.broadcastToClients({
          type: 'command_result',
          data: { command: command.type, result }
        });

      } catch (error) {
        logger.error('Command execution failed via API', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Browser status endpoint
    this.app.get('/api/status', async (_req, res) => {
      try {
        const pageInfo = await this.browserManager.getPageInfo();
        res.json({
          initialized: this.browserManager.isInitialized(),
          pageInfo,
          connectedClients: this.connectedClients.size
        });
      } catch (error) {
        logger.error('Failed to get browser status', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        res.status(500).json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Serve main page
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      
      logger.info('WebSocket client connected', { 
        clientId,
        totalClients: this.connectedClients.size + 1 
      });

      this.connectedClients.add(ws);

      // Send initial status
      ws.send(JSON.stringify({
        type: 'status',
        data: {
          initialized: this.browserManager.isInitialized(),
          connectedClients: this.connectedClients.size
        }
      }));

      ws.on('message', async (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          
          logger.info('WebSocket message received', { 
            clientId,
            type: message.type 
          });

          await this.handleWebSocketMessage(ws, message);

        } catch (error) {
          logger.error('WebSocket message error', { 
            clientId,
            error: error instanceof Error ? error.message : String(error) 
          });

          ws.send(JSON.stringify({
            type: 'error',
            error: 'Invalid message format'
          }));
        }
      });

      ws.on('close', () => {
        this.connectedClients.delete(ws);
        logger.info('WebSocket client disconnected', { 
          clientId,
          totalClients: this.connectedClients.size 
        });
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error', { 
          clientId,
          error: error.message 
        });
      });
    });
  }

  private async handleWebSocketMessage(ws: WebSocket, message: WSMessage): Promise<void> {
    switch (message.type) {
      case 'browser_start':
        try {
          await this.browserManager.initialize();
          ws.send(JSON.stringify({
            type: 'browser_started',
            id: message.id
          }));
          this.broadcastToClients({ type: 'browser_started' }, ws);
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            id: message.id
          }));
        }
        break;

      case 'browser_stop':
        try {
          await this.browserManager.close();
          ws.send(JSON.stringify({
            type: 'browser_stopped',
            id: message.id
          }));
          this.broadcastToClients({ type: 'browser_stopped' }, ws);
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            id: message.id
          }));
        }
        break;

      case 'command':
        try {
          const result = await this.browserManager.executeCommand(message.data);
          ws.send(JSON.stringify({
            type: 'command_result',
            data: result,
            id: message.id
          }));

          // Broadcast to other clients
          this.broadcastToClients({
            type: 'command_executed',
            data: { command: message.data.type, result }
          }, ws);

        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            id: message.id
          }));
        }
        break;

      case 'get_status':
        try {
          const pageInfo = await this.browserManager.getPageInfo();
          ws.send(JSON.stringify({
            type: 'status',
            data: {
              initialized: this.browserManager.isInitialized(),
              pageInfo,
              connectedClients: this.connectedClients.size
            },
            id: message.id
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            id: message.id
          }));
        }
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`,
          id: message.id
        }));
    }
  }

  private broadcastToClients(message: WSMessage, exclude?: WebSocket): void {
    const messageStr = JSON.stringify(message);
    
    this.connectedClients.forEach((client) => {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(config.port, () => {
        logger.info('Warg server started', { 
          port: config.port,
          pid: process.pid 
        });
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error('Server error', { 
          error: error.message 
        });
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping Warg server');

    await this.browserManager.close();

    this.connectedClients.forEach((client) => {
      client.close();
    });

    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('Warg server stopped');
        resolve();
      });
    });
  }
}

async function main(): Promise<void> {
  const server = new WargServer();

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully');
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Server failed to start', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  });
}