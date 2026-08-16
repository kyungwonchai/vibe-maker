#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const appName = process.argv[2];
const port = parseInt(process.argv[3], 10);
const icon = process.argv[4] || '🚀';
const desc = process.argv[5] || `${appName} 웹앱`;

if (!appName || !port) {
  console.error('Usage: auto-register.mjs <app-name> <port> [icon] [desc]');
  process.exit(1);
}

const DASHBOARD_DIR = '/home/kw/kwsoft/dashboard';
const SERVICES_FILE = path.join(DASHBOARD_DIR, 'services.json');
const APPS_FILE = path.join(DASHBOARD_DIR, 'portal/apps.json');
const APP_TSX = path.join(DASHBOARD_DIR, 'src/App.tsx');
const APP_PATH = `/home/kw/kwsoft/${appName}`;

console.log(`🚀 [Auto-Register] Registering ${appName} on port ${port}...`);

// 1. Update services.json
try {
  const servicesJson = JSON.parse(readFileSync(SERVICES_FILE, 'utf8'));
  const list = Array.isArray(servicesJson) ? servicesJson : servicesJson.services;
  if (!list.find(s => s.id === appName)) {
    list.push({
      id: appName,
      name: appName,
      description: desc,
      port: port,
      path: APP_PATH,
      url: `https://kwopi.duckdns.org/${appName}/`,
      localUrl: `http://172.30.1.70:${port}/`,
      icon: icon,
      runner: 'manage',
    });
    writeFileSync(SERVICES_FILE, JSON.stringify(servicesJson, null, 2), 'utf8');
    console.log('✅ services.json updated');
  }
} catch (e) {
  console.warn('services.json update error:', e.message);
}

// 2. Update portal/apps.json
try {
  const portalJson = JSON.parse(readFileSync(APPS_FILE, 'utf8'));
  if (!portalJson.apps.find(a => a.id === appName)) {
    portalJson.apps.push({
      id: appName,
      domain: 'kwopi.duckdns.org',
      name: appName,
      desc: desc,
      expose: 'public',
      path: `/${appName}/`,
      upstream: `127.0.0.1:${port}`,
      upstreamPath: '/',
      ws: true,
      icon: icon,
    });
    writeFileSync(APPS_FILE, JSON.stringify(portalJson, null, 2), 'utf8');
    console.log('✅ portal/apps.json updated');
  }
} catch (e) {
  console.warn('portal/apps.json update error:', e.message);
}

// 3. Update dashboard App.tsx play tab filter
try {
  let appTsx = readFileSync(APP_TSX, 'utf8');
  if (!appTsx.includes(`'${appName}'`)) {
    appTsx = appTsx.replace(
      /filterIds=\{\[([^\]]+)\]\}/,
      (match, p1) => `filterIds={['${appName}', ${p1}]}`
    );
    writeFileSync(APP_TSX, appTsx, 'utf8');
    console.log('✅ App.tsx updated');
    execSync('npm run build', { cwd: DASHBOARD_DIR, stdio: 'ignore' });
    console.log('✅ Dashboard rebuilt');
  }
} catch (e) {
  console.warn('App.tsx update error:', e.message);
}

// 4. Run kw-apply-sites to reload Nginx
try {
  execSync('sudo -n /usr/local/bin/kw-apply-sites', { stdio: 'inherit' });
  console.log('✅ Nginx reloaded successfully via kw-apply-sites');
} catch (e) {
  console.warn('kw-apply-sites error:', e.message);
}
