process.env.REPO_DRIVER = 'memory'; process.env.NODE_ENV = 'test'; process.env.AUTH_SESSION_SECRET = 'x'.repeat(48);
require('reflect-metadata');
try {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('./dist/app.module');
  const { DATABASE } = require('@aipowersalon/database');
  NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }).then(async (app) => {
    console.log('nest graph booted; DATABASE =', app.get(DATABASE, { strict: false })); await app.close(); process.exit(0);
  }).catch((e) => { console.log('BOOT FAILED:', String(e && e.message).slice(0, 400)); process.exit(1); });
} catch (e) { console.log('LOAD FAILED:', String(e && e.message).slice(0, 400)); process.exit(1); }
