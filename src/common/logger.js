const winston = require('winston');
const config = require('./config');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'registration-center' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(info => 
          `${info.timestamp} ${info.level}: ${info.message} ${
            Object.keys(info).filter(key => 
              !['timestamp', 'level', 'message', 'service'].includes(key)
            ).length > 0
              ? JSON.stringify(Object.fromEntries(
                  Object.entries(info).filter(([key]) => 
                    !['timestamp', 'level', 'message', 'service'].includes(key)
                  )
                ))
              : ''
          }`
        )
      )
    })
  ],
});

module.exports = logger; 