import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const caller = getCaller();
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${caller} ${message} ${metaStr}${stackStr}`;
  })
);

function getCaller(): string {
  const stack = new Error().stack;
  if (!stack) return 'unknown:0';
  
  const lines = stack.split('\n');
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (line && !line.includes('node_modules') && !line.includes('logger.ts')) {
      const match = line.match(/at .* \((.+):(\d+):\d+\)/);
      if (match) {
        const filename = path.basename(match[1]);
        return `${filename}:${match[2]}`;
      }
    }
  }
  return 'unknown:0';
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: process.env.LOG_FILE || path.join(logDir, 'warg.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ]
});

export default logger;