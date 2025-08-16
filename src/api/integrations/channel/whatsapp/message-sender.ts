import { Logger } from '@config/logger.config';
import { AnyMessageContent, MiscMessageGenerationOptions, WASocket } from 'baileys';

import { ConnectionManager } from './connection-manager';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
  idempotencyKey?: string;
}

interface SendMessageOptions extends MiscMessageGenerationOptions {
  messageId?: string;
}

export class MessageSender {
  private readonly logger = new Logger('MessageSender');
  private readonly pendingMessages = new Map<string, boolean>();
  private readonly connectionManager: ConnectionManager;

  constructor(instanceName: string, connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Sends a message with retry logic and connection validation
   */
  async sendWithRetry(
    client: WASocket | null,
    connectionState: string,
    reconnectFn: () => Promise<WASocket>,
    remoteJid: string,
    content: AnyMessageContent,
    options: SendMessageOptions = {},
    retryOptions: RetryOptions = {},
  ): Promise<any> {
    const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000, jitterFactor = 0.2, idempotencyKey } = retryOptions;

    // Generate idempotency key if not provided
    const messageKey = idempotencyKey || this.generateIdempotencyKey(remoteJid, content, options);

    // Check for duplicate message (idempotency)
    if (this.pendingMessages.has(messageKey)) {
      this.logger.debug(`Message with key ${messageKey} is already being sent`);
      throw new Error('Message is already being sent');
    }

    this.pendingMessages.set(messageKey, true);

    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Ensure connection is ready
          const activeClient = await this.connectionManager.ensureConnected(client, connectionState, reconnectFn);

          this.logger.debug(`Sending message attempt ${attempt}/${maxRetries} to ${remoteJid}`);

          // Send the message
          const result = await activeClient.sendMessage(remoteJid, content, options);

          this.logger.debug(`Message sent successfully to ${remoteJid}`);
          return result;
        } catch (error) {
          this.logger.error(`Message send attempt ${attempt} failed: ${error.message}`);

          // Check if error is retryable
          if (!ConnectionManager.isRetryableError(error) || attempt === maxRetries) {
            throw error;
          }

          // Calculate backoff delay
          const delayMs = this.calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
          this.logger.debug(`Waiting ${delayMs}ms before retry attempt ${attempt + 1}`);

          await this.delay(delayMs);
        }
      }

      throw new Error(`Failed to send message after ${maxRetries} attempts`);
    } finally {
      this.pendingMessages.delete(messageKey);
    }
  }

  /**
   * Sends presence update with retry logic
   */
  async sendPresenceWithRetry(
    client: WASocket | null,
    connectionState: string,
    reconnectFn: () => Promise<WASocket>,
    presence: 'unavailable' | 'available' | 'composing' | 'recording' | 'paused',
    remoteJid?: string,
    retryOptions: RetryOptions = {},
  ): Promise<void> {
    const { maxRetries = 2, baseDelayMs = 500 } = retryOptions;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Ensure connection is ready
        const activeClient = await this.connectionManager.ensureConnected(client, connectionState, reconnectFn);

        await activeClient.sendPresenceUpdate(presence, remoteJid);
        return;
      } catch (error) {
        this.logger.error(`Presence update attempt ${attempt} failed: ${error.message}`);

        if (!ConnectionManager.isRetryableError(error) || attempt === maxRetries) {
          // Don't throw for presence updates, just log
          this.logger.warn(`Failed to send presence update after ${maxRetries} attempts`);
          return;
        }

        await this.delay(baseDelayMs * attempt);
      }
    }
  }

  /**
   * Generates a stable idempotency key for a message
   */
  private generateIdempotencyKey(remoteJid: string, content: AnyMessageContent, options: SendMessageOptions): string {
    const contentStr = JSON.stringify(content);
    const optionsStr = JSON.stringify({
      messageId: options.messageId,
      quoted: options.quoted?.key,
    });

    // Create a simple hash
    const hash = this.simpleHash(remoteJid + contentStr + optionsStr);
    return `msg_${hash}_${Date.now()}`;
  }

  /**
   * Simple hash function for idempotency keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Calculates exponential backoff delay with jitter
   */
  private calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number,
    maxDelayMs: number,
    jitterFactor: number,
  ): number {
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = exponentialDelay * jitterFactor * Math.random();
    const totalDelay = exponentialDelay + jitter;

    return Math.min(totalDelay, maxDelayMs);
  }

  /**
   * Promise-based delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clears all pending messages (useful for instance restart)
   */
  clearPendingMessages(): void {
    this.pendingMessages.clear();
  }

  /**
   * Gets count of pending messages
   */
  getPendingMessagesCount(): number {
    return this.pendingMessages.size;
  }
}
