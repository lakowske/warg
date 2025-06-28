import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface Config {
  port: number;
  logLevel: string;
  logFile: string;
  browserHeadless: boolean;
  browserTimeout: number;
  pidFile: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || path.join('logs', 'warg.log'),
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserTimeout: parseInt(process.env.BROWSER_TIMEOUT || '30000', 10),
  pidFile: path.join(process.cwd(), 'warg.pid')
};

export default config;