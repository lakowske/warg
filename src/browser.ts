import puppeteer, { Browser, Page } from 'puppeteer';
import logger from './logger.js';
import config from './config.js';

export interface BrowserCommand {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'evaluate' | 'reload' | 'back' | 'forward';
  data?: any;
}

export interface BrowserResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitializing = false;

  async initialize(): Promise<void> {
    if (this.isInitializing) {
      logger.warn('Browser initialization already in progress');
      return;
    }

    if (this.browser) {
      logger.warn('Browser already initialized');
      return;
    }

    this.isInitializing = true;
    
    try {
      logger.info('Initializing browser', { 
        headless: config.browserHeadless,
        timeout: config.browserTimeout 
      });

      this.browser = await puppeteer.launch({
        headless: config.browserHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        timeout: config.browserTimeout
      });

      this.page = await this.browser.newPage();
      
      await this.page.setViewport({ width: 1280, height: 720 });
      
      this.page.on('error', (error) => {
        logger.error('Page error', { error: error.message });
      });

      this.page.on('pageerror', (error) => {
        logger.error('Page script error', { error: error.message });
      });

      this.page.on('console', (msg) => {
        logger.debug('Browser console', { 
          type: msg.type(),
          text: msg.text() 
        });
      });

      logger.info('Browser initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize browser', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this.browser = null;
      this.page = null;
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  async close(): Promise<void> {
    logger.info('Closing browser');

    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      logger.info('Browser closed successfully');

    } catch (error) {
      logger.error('Error closing browser', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async executeCommand(command: BrowserCommand): Promise<BrowserResponse> {
    if (!this.page) {
      return {
        success: false,
        error: 'Browser not initialized'
      };
    }

    logger.info('Executing browser command', { 
      type: command.type,
      data: command.data ? JSON.stringify(command.data).substring(0, 100) : undefined
    });

    try {
      switch (command.type) {
        case 'navigate':
          await this.page.goto(command.data.url, { 
            waitUntil: 'networkidle2',
            timeout: config.browserTimeout 
          });
          return { 
            success: true, 
            data: { url: this.page.url() } 
          };

        case 'click':
          await this.page.click(command.data.selector);
          return { success: true };

        case 'type':
          await this.page.type(command.data.selector, command.data.text);
          return { success: true };

        case 'screenshot':
          const screenshot = await this.page.screenshot({ 
            encoding: 'base64',
            fullPage: command.data?.fullPage || false
          });
          return { 
            success: true, 
            data: { screenshot } 
          };

        case 'evaluate':
          const result = await this.page.evaluate(command.data.script);
          return { 
            success: true, 
            data: { result } 
          };

        case 'reload':
          await this.page.reload({ 
            waitUntil: 'networkidle2',
            timeout: config.browserTimeout 
          });
          return { 
            success: true, 
            data: { url: this.page.url() } 
          };

        case 'back':
          await this.page.goBack({ 
            waitUntil: 'networkidle2',
            timeout: config.browserTimeout 
          });
          return { 
            success: true, 
            data: { url: this.page.url() } 
          };

        case 'forward':
          await this.page.goForward({ 
            waitUntil: 'networkidle2',
            timeout: config.browserTimeout 
          });
          return { 
            success: true, 
            data: { url: this.page.url() } 
          };

        default:
          return {
            success: false,
            error: `Unknown command type: ${command.type}`
          };
      }

    } catch (error) {
      logger.error('Browser command failed', { 
        type: command.type,
        error: error instanceof Error ? error.message : String(error) 
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getPageInfo(): Promise<any> {
    if (!this.page) {
      return null;
    }

    try {
      const [title, url] = await Promise.all([
        this.page.title(),
        Promise.resolve(this.page.url())
      ]);

      return { title, url };

    } catch (error) {
      logger.error('Failed to get page info', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  isInitialized(): boolean {
    return this.browser !== null && this.page !== null;
  }
}