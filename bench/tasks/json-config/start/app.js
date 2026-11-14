const fs = require('node:fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
if (typeof cfg.port !== 'number' || !Number.isInteger(cfg.port)) throw new Error('port must be an integer');
if (typeof cfg.host !== 'string') throw new Error('host must be a string');
if (!Array.isArray(cfg.features)) throw new Error('features must be an array');
if (typeof cfg.limits?.maxUploadMb !== 'number') throw new Error('limits.maxUploadMb must be a number');
console.log(`ok host=${cfg.host} port=${cfg.port} features=${cfg.features.join(',')} maxUploadMb=${cfg.limits.maxUploadMb}`);
