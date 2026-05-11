import pino from 'pino';

let _logger: pino.Logger | null = null;

export function getLogger(level: string = 'info'): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level,
      transport: level === 'debug'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    });
  }
  return _logger;
}
