import { Logger, LogLevelType } from '../types';
import * as winston from 'winston';

export class TerraformerLogger implements Logger {
  private winston: winston.Logger;

  constructor(level: LogLevelType = 'info') {
    this.winston = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'terraformer' },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  error(message: string, ...args: any[]): void {
    this.winston.error(message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.winston.warn(message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.winston.info(message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.winston.debug(message, ...args);
  }

  setLevel(level: LogLevelType): void {
    this.winston.level = level;
  }
}

export class ConsoleLogger implements Logger {
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (this.verbose) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
}


