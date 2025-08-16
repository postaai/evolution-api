import { Logger } from '@config/logger.config';
import { ConnectionState, delay, DisconnectReason, WASocket } from 'baileys';

interface ConnectionManagerOptions {
  instanceName: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

export class ConnectionManager {
  private readonly logger = new Logger('ConnectionManager');
  private reconnecting = false;
  private retryCount = 0;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterFactor: number;
  private readonly instanceName: string;
  private lastConnectionState: string = 'close';

  constructor(options: ConnectionManagerOptions) {
    this.instanceName = options.instanceName;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.jitterFactor = options.jitterFactor ?? 0.2;
  }

  /**
   * Ensures the connection is open before proceeding
   * Implements single-flight pattern to prevent concurrent reconnections
   */
  async ensureConnected(
    client: WASocket | null,
    connectionState: string,
    reconnectFn: () => Promise<WASocket>,
  ): Promise<WASocket> {
    // If already connecting, wait and return
    if (this.reconnecting) {
      this.logger.debug(`[${this.instanceName}] Already reconnecting, waiting...`);
      await this.waitForReconnection();
      return client;
    }

    // If connection is open, return immediately
    if (connectionState === 'open' && client) {
      this.retryCount = 0; // Reset retry count on successful connection
      return client;
    }

    // If logged out, don't attempt reconnection
    if (connectionState === 'close' && this.lastConnectionState === 'loggedOut') {
      throw new Error('Instance is logged out. Manual reauth required.');
    }

    this.logger.warn(
      `[${this.instanceName}] Connection not open (${connectionState}), initiating controlled reconnection`,
    );

    return await this.performControlledReconnection(client, reconnectFn);
  }

  /**
   * Performs a controlled reconnection with proper cleanup and delay
   */
  private async performControlledReconnection(
    client: WASocket | null,
    reconnectFn: () => Promise<WASocket>,
  ): Promise<WASocket> {
    if (this.reconnecting) {
      await this.waitForReconnection();
      return client;
    }

    this.reconnecting = true;

    try {
      // Ensure clean shutdown of existing connection
      if (client) {
        this.logger.debug(`[${this.instanceName}] Cleaning up existing connection`);
        try {
          client.ws?.close();
          client.end(new Error('Controlled reconnection'));
        } catch (error) {
          this.logger.debug(`[${this.instanceName}] Error during cleanup: ${error.message}`);
        }
      }

      // Wait for cleanup to complete
      await delay(1500);

      // Attempt reconnection with exponential backoff
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          this.logger.info(`[${this.instanceName}] Reconnection attempt ${attempt}/${this.maxRetries}`);

          const newClient = await reconnectFn();

          // Wait for connection to be established
          const connected = await this.waitForConnection(newClient, 30000);

          if (connected) {
            this.logger.info(`[${this.instanceName}] Reconnection successful`);
            this.retryCount = 0;
            return newClient;
          } else {
            throw new Error('Connection timeout after 30 seconds');
          }
        } catch (error) {
          this.logger.error(`[${this.instanceName}] Reconnection attempt ${attempt} failed: ${error.message}`);

          if (attempt < this.maxRetries) {
            const delayMs = this.calculateBackoffDelay(attempt);
            this.logger.debug(`[${this.instanceName}] Waiting ${delayMs}ms before next attempt`);
            await delay(delayMs);
          }
        }
      }

      throw new Error(`Failed to reconnect after ${this.maxRetries} attempts`);
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Waits for an active reconnection to complete
   */
  private async waitForReconnection(timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();

    while (this.reconnecting && Date.now() - startTime < timeoutMs) {
      await delay(500);
    }

    if (this.reconnecting) {
      throw new Error('Timeout waiting for reconnection to complete');
    }
  }

  /**
   * Waits for the connection to be established
   */
  private async waitForConnection(client: WASocket, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const connectionListener = (update: Partial<ConnectionState>) => {
        if (update.connection === 'open') {
          cleanup();
          resolve(true);
        } else if (update.connection === 'close') {
          const lastDisconnect = update.lastDisconnect as any;
          const statusCode = lastDisconnect?.error?.output?.statusCode;

          if (statusCode === DisconnectReason.loggedOut) {
            this.lastConnectionState = 'loggedOut';
          }

          cleanup();
          resolve(false);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        client.ev.off('connection.update', connectionListener);
      };

      client.ev.on('connection.update', connectionListener);
    });
  }

  /**
   * Calculates exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = exponentialDelay * this.jitterFactor * Math.random();
    const totalDelay = exponentialDelay + jitter;

    return Math.min(totalDelay, this.maxDelayMs);
  }

  /**
   * Checks if an error is retryable
   */
  static isRetryableError(error: any): boolean {
    if (!error) return false;

    const statusCode = error.output?.statusCode || error.statusCode;
    const message = error.message || '';

    // Retryable status codes
    const retryableCodes = [428, 408, 502, 503, 504];

    // Retryable error messages
    const retryableMessages = ['Connection Closed', 'connection lost', 'timedOut', 'restartRequired', 'connectionLost'];

    return (
      retryableCodes.includes(statusCode) ||
      retryableMessages.some((msg) => message.toLowerCase().includes(msg.toLowerCase()))
    );
  }

  /**
   * Reset retry counter
   */
  resetRetryCount(): void {
    this.retryCount = 0;
  }

  /**
   * Get current retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Check if currently reconnecting
   */
  isReconnecting(): boolean {
    return this.reconnecting;
  }
}
