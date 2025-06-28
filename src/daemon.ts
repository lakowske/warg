#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import logger from './logger.js';
import config from './config.js';

interface DaemonStatus {
  pid?: number;
  running: boolean;
  uptime?: number;
  startTime?: Date;
}

class WargDaemon {
  private serverProcess: ChildProcess | null = null;
  private startTime: Date | null = null;

  async start(): Promise<void> {
    logger.info('Starting Warg daemon', { pid: process.pid });

    if (await this.isRunning()) {
      logger.warn('Daemon already running', { pid: await this.getPid() });
      return;
    }

    try {
      await this.writePidFile();
      await this.startServer();
      
      process.on('SIGTERM', () => this.shutdown('SIGTERM'));
      process.on('SIGINT', () => this.shutdown('SIGINT'));
      process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', { error: error.message, stack: error.stack });
        this.shutdown('uncaughtException');
      });

      logger.info('Warg daemon started successfully', { 
        pid: process.pid,
        port: config.port 
      });

    } catch (error) {
      logger.error('Failed to start daemon', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping Warg daemon');

    const pid = await this.getPid();
    if (!pid) {
      logger.warn('No PID file found, daemon may not be running');
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
      logger.info('Stop signal sent to daemon', { pid });
      
      // Wait for graceful shutdown
      await this.waitForShutdown(pid, 10000);
      
    } catch (error) {
      logger.error('Failed to stop daemon', { 
        error: error instanceof Error ? error.message : String(error),
        pid 
      });
      throw error;
    }
  }

  async restart(): Promise<void> {
    logger.info('Restarting Warg daemon');
    await this.stop();
    
    // Wait a moment before restart
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await this.start();
  }

  async status(): Promise<DaemonStatus> {
    const pid = await this.getPid();
    const running = pid ? await this.isProcessRunning(pid) : false;
    
    const status: DaemonStatus = { running };
    
    if (running && pid) {
      status.pid = pid;
      if (this.startTime) {
        status.startTime = this.startTime;
        status.uptime = Date.now() - this.startTime.getTime();
      }
    }

    return status;
  }

  private async startServer(): Promise<void> {
    const serverPath = path.join(process.cwd(), 'dist', 'server.js');
    
    logger.info('Starting server process', { serverPath });
    
    this.serverProcess = spawn('node', [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    this.startTime = new Date();

    if (!this.serverProcess.stdout || !this.serverProcess.stderr) {
      throw new Error('Failed to create server process streams');
    }

    this.serverProcess.stdout.on('data', (data) => {
      logger.info('Server stdout', { output: data.toString().trim() });
    });

    this.serverProcess.stderr.on('data', (data) => {
      logger.error('Server stderr', { output: data.toString().trim() });
    });

    this.serverProcess.on('error', (error) => {
      logger.error('Server process error', { error: error.message });
    });

    this.serverProcess.on('exit', (code, signal) => {
      logger.warn('Server process exited', { code, signal });
      this.serverProcess = null;
      
      if (code !== 0 && code !== null) {
        logger.error('Server crashed, attempting restart in 5 seconds');
        setTimeout(() => this.startServer(), 5000);
      }
    });

    // Give the server a moment to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (!this.serverProcess || this.serverProcess.killed) {
      throw new Error('Server failed to start');
    }
  }

  private async shutdown(reason: string): Promise<void> {
    logger.info('Shutting down daemon', { reason });

    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (!this.serverProcess.killed) {
        logger.warn('Force killing server process');
        this.serverProcess.kill('SIGKILL');
      }
    }

    await this.removePidFile();
    logger.info('Daemon shutdown complete');
    process.exit(0);
  }

  private async writePidFile(): Promise<void> {
    try {
      await fs.writeFile(config.pidFile, process.pid.toString());
      logger.debug('PID file written', { pidFile: config.pidFile, pid: process.pid });
    } catch (error) {
      logger.error('Failed to write PID file', { 
        error: error instanceof Error ? error.message : String(error),
        pidFile: config.pidFile 
      });
      throw error;
    }
  }

  private async removePidFile(): Promise<void> {
    try {
      await fs.unlink(config.pidFile);
      logger.debug('PID file removed', { pidFile: config.pidFile });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to remove PID file', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
  }

  private async getPid(): Promise<number | null> {
    try {
      const pidStr = await fs.readFile(config.pidFile, 'utf8');
      return parseInt(pidStr.trim(), 10);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.debug('Could not read PID file', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
      return null;
    }
  }

  private async isRunning(): Promise<boolean> {
    const pid = await this.getPid();
    return pid ? await this.isProcessRunning(pid) : false;
  }

  private async isProcessRunning(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitForShutdown(pid: number, timeout: number): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (!await this.isProcessRunning(pid)) {
        logger.info('Daemon shutdown confirmed', { pid });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.warn('Timeout waiting for daemon shutdown, force killing', { pid });
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      logger.error('Failed to force kill daemon', { 
        error: error instanceof Error ? error.message : String(error),
        pid 
      });
    }
  }
}

async function main(): Promise<void> {
  const daemon = new WargDaemon();
  const command = process.argv[2];

  switch (command) {
    case 'start':
      await daemon.start();
      break;
    case 'stop':
      await daemon.stop();
      break;
    case 'restart':
      await daemon.restart();
      break;
    case 'status':
      const status = await daemon.status();
      console.log(JSON.stringify(status, null, 2));
      break;
    default:
      logger.info('Starting daemon in foreground mode');
      await daemon.start();
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Daemon failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  });
}