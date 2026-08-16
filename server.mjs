import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { readdirSync, existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawn, execSync, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 10147;
const BASE_DIRS = ['/home/kw/kwsoft', '/home/kw'];
const SESSION_PREFIX = 'agy-vibe-';
const HISTORY_FILE = path.join(__dirname, 'vibe-history.json');

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Set up Environment for agy CLI
const ENV = {
  ...process.env,
  PATH: `/home/kw/.local/bin:/home/kw/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
  HOME: '/home/kw',
  SHELL: '/bin/bash',
  TERM: 'xterm-256color',
};
const AGY_BIN = existsSync('/home/kw/.local/bin/agy') ? '/home/kw/.local/bin/agy' : 'agy';

const LOGS_DIR = path.join(__dirname, 'logs');
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    const now = Date.now();
    // Keep logs within 30 days
    const valid = (Array.isArray(data) ? data : []).filter(item => {
      return (now - (item.timestamp || 0)) <= THIRTY_DAYS_MS;
    });
    return valid;
  } catch {
    return [];
  }
}

function saveHistory(item) {
  try {
    const list = loadHistory();
    list.unshift({
      id: 'vibe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      ...item,
    });
    // Write back 30-day filtered history
    writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('History save error:', e.message);
  }
}

function updateHistoryStatus(sessionName, status, logExcerpt) {
  try {
    const list = loadHistory();
    const item = list.find(h => h.sessionName === sessionName);
    if (item) {
      item.status = status;
      item.finishedAt = Date.now();
      if (logExcerpt) item.logExcerpt = logExcerpt;
      writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf8');
    }
  } catch {}
}

// 1. App / Folder Scan API
const handleApps = (req, res) => {
  try {
    const results = [];
    const seenPaths = new Set();

    // Load services.json & portal/apps.json to determine kwboard registration
    const registeredIds = new Set();
    try {
      const servicesRaw = JSON.parse(readFileSync('/home/kw/kwsoft/dashboard/services.json', 'utf8'));
      const sList = Array.isArray(servicesRaw) ? servicesRaw : (servicesRaw.services || []);
      sList.forEach(s => {
        if (s.id) registeredIds.add(s.id);
        if (s.name) registeredIds.add(s.name);
        if (s.path) registeredIds.add(path.basename(s.path));
      });
    } catch {}

    try {
      const portalRaw = JSON.parse(readFileSync('/home/kw/kwsoft/dashboard/portal/apps.json', 'utf8'));
      if (portalRaw && Array.isArray(portalRaw.apps)) {
        portalRaw.apps.forEach(a => {
          if (a.id) registeredIds.add(a.id);
          if (a.name) registeredIds.add(a.name);
        });
      }
    } catch {}

    registeredIds.add('dashboard');
    registeredIds.add('kwboard');

    // 1) Scan /home/kw/kwsoft
    const kwsoftDir = '/home/kw/kwsoft';
    if (existsSync(kwsoftDir)) {
      const entries = readdirSync(kwsoftDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          const fullPath = path.join(kwsoftDir, e.name);
          seenPaths.add(fullPath);
          const hasGit = existsSync(path.join(fullPath, '.git'));
          const hasPackageJson = existsSync(path.join(fullPath, 'package.json'));
          const hasManage = existsSync(path.join(fullPath, 'manage.sh'));
          const isKwboard = registeredIds.has(e.name) || registeredIds.has(path.basename(fullPath));
          results.push({
            name: e.name,
            path: fullPath,
            category: 'kwsoft',
            isRegisteredInKwboard: isKwboard,
            hasGit,
            hasPackageJson,
            hasManage,
          });
        }
      }
    }

    // 2) Scan other selected apps in /home/kw
    const homeDir = '/home/kw';
    if (existsSync(homeDir)) {
      const entries = readdirSync(homeDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'kwsoft' && e.name !== 'node_modules') {
          const fullPath = path.join(homeDir, e.name);
          if (!seenPaths.has(fullPath)) {
            const hasGit = existsSync(path.join(fullPath, '.git'));
            const hasPackageJson = existsSync(path.join(fullPath, 'package.json'));
            if (hasGit || hasPackageJson) {
              const isKwboard = registeredIds.has(e.name);
              results.push({
                name: e.name,
                path: fullPath,
                category: 'home',
                isRegisteredInKwboard: isKwboard,
                hasGit,
                hasPackageJson,
                hasManage: existsSync(path.join(fullPath, 'manage.sh')),
              });
            }
          }
        }
      }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, apps: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
app.get('/api/apps', handleApps);
app.get('/vibe-maker/api/apps', handleApps);

// 2. Active Session Status API
function getActiveSessions() {
  try {
    const out = execSync("tmux list-sessions -F '#{session_name} #{session_created}' 2>/dev/null", { env: ENV, encoding: 'utf8' });
    const list = out.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const parts = line.split(' ');
      return { name: parts[0], created: parseInt(parts[1] || '0', 10) };
    });
    // Sort by newest created first
    list.sort((a, b) => b.created - a.created);
    return list.map(item => item.name).filter(s => s.startsWith(SESSION_PREFIX) || s === 'agy');
  } catch {
    return [];
  }
}

const handleStatus = (req, res) => {
  const sessions = getActiveSessions();
  const targetSession = req.query.session || (sessions.length > 0 ? sessions[0] : null);
  let panePreview = '';
  
  if (targetSession) {
    try {
      panePreview = execFileSync('tmux', ['capture-pane', '-pt', targetSession, '-S', '-50'], {
        env: ENV,
        encoding: 'utf8',
        timeout: 3000,
      }).trimEnd();
    } catch (e) {
      panePreview = `(세션 출력 대기 중... ${e.message})`;
    }
  }

  res.json({
    ok: true,
    activeSessions: sessions,
    currentSession: targetSession,
    panePreview,
  });
};
app.get('/api/status', handleStatus);
app.get('/vibe-maker/api/status', handleStatus);

// 3. Execution API (Create/Modify App with agy in YOLO mode)
const handleExecute = async (req, res) => {
  const { mode, appPath, newAppName, prompt, autoClose = true } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ ok: false, error: '명령 프롬프트를 입력해주세요.' });
  }

  let targetDir = '';
  let targetName = '';

  if (mode === 'create') {
    if (!newAppName || !newAppName.trim()) {
      return res.status(400).json({ ok: false, error: '새로 만들 앱 폴더명을 입력해주세요.' });
    }
    targetName = newAppName.trim().replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    targetDir = path.join('/home/kw/kwsoft', targetName);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
  } else {
    if (!appPath || !existsSync(appPath)) {
      return res.status(400).json({ ok: false, error: '수정할 앱 폴더를 찾을 수 없습니다.' });
    }
    targetDir = appPath;
    targetName = path.basename(appPath);
  }

  const cleanSessionName = `${SESSION_PREFIX}${targetName.slice(0, 15)}-${Date.now().toString().slice(-4)}`;
  const logFilePath = path.join(LOGS_DIR, `${cleanSessionName}.log`);

  try {
    try {
      execSync(`tmux kill-session -t ${cleanSessionName} 2>/dev/null || true`, { env: ENV });
    } catch {}

    // 1) Create new tmux session in target directory
    execFileSync('tmux', ['new-session', '-d', '-s', cleanSessionName, '-c', targetDir], { env: ENV });
    await new Promise(r => setTimeout(r, 400));

    // 2) Enable pipe-pane to save all terminal outputs directly to log file
    try {
      execFileSync('tmux', ['pipe-pane', '-t', cleanSessionName, '-o', `cat >> "${logFilePath}"`], { env: ENV });
    } catch {}

    // 3) Run runner.sh script
    const runnerScript = '/home/kw/kwsoft/vibe-maker/scripts/runner.sh';
    const runCmd = `bash "${runnerScript}" "${targetDir}" "${targetName}" "${logFilePath}" "${cleanSessionName}" "${prompt.replace(/"/g, '\\"')}"`;
    execFileSync('tmux', ['send-keys', '-t', cleanSessionName, runCmd, 'Enter'], { env: ENV });

    saveHistory({
      mode,
      targetDir,
      targetName,
      prompt,
      sessionName: cleanSessionName,
      logFile: `${cleanSessionName}.log`,
      status: 'started',
    });

    res.json({
      ok: true,
      message: `⚡ [${targetName}]에 대해 agy 바이브 작업이 시작되었습니다.`,
      sessionName: cleanSessionName,
      targetDir,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: '실행 실패: ' + e.message });
  }
};
app.post('/api/execute', handleExecute);
app.post('/vibe-maker/api/execute', handleExecute);

// 3-1. Session Completion Webhook & Notification
let lastCompletedEvent = null;

const handleSessionDone = (req, res) => {
  const { session, targetName, exitCode = 0 } = req.body;
  const success = parseInt(exitCode, 10) === 0;
  updateHistoryStatus(session, success ? 'completed' : 'failed');

  lastCompletedEvent = {
    id: 'evt_' + Date.now(),
    session: session || '',
    targetName: targetName || '앱',
    success,
    exitCode,
    timestamp: Date.now(),
  };

  const broadcastData = JSON.stringify({
    type: 'complete',
    event: lastCompletedEvent,
  });

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(broadcastData); } catch {}
    }
  });

  res.json({ ok: true, event: lastCompletedEvent });
};
app.post('/api/session-done', handleSessionDone);
app.post('/vibe-maker/api/session-done', handleSessionDone);

const handleLatestEvent = (req, res) => {
  res.json({ ok: true, lastCompletedEvent });
};
app.get('/api/latest-event', handleLatestEvent);
app.get('/vibe-maker/api/latest-event', handleLatestEvent);


// 4. Session Action (Ctrl+C, Kill)
const handleSessionAction = (req, res) => {
  const { session, action } = req.body;
  if (!session) return res.status(400).json({ ok: false, error: 'Session required' });

  try {
    if (action === 'ctrl-c') {
      execFileSync('tmux', ['send-keys', '-t', session, 'C-c'], { env: ENV });
      return res.json({ ok: true, message: '중단(Ctrl+C) 신호를 보냈습니다.' });
    } else if (action === 'kill') {
      execSync(`tmux kill-session -t ${session} 2>/dev/null || true`, { env: ENV });
      return res.json({ ok: true, message: '세션을 강제 종료했습니다.' });
    }
    res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
app.post('/api/session-action', handleSessionAction);
app.post('/vibe-maker/api/session-action', handleSessionAction);

// 5. History API (30-day Retention & Log Viewer)
const handleHistory = (req, res) => {
  res.json({ ok: true, history: loadHistory() });
};
app.get('/api/history', handleHistory);
app.get('/vibe-maker/api/history', handleHistory);

const handleHistoryLog = (req, res) => {
  const { id } = req.params;
  const list = loadHistory();
  const item = list.find(h => h.id === id || h.sessionName === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: '기록을 찾을 수 없습니다.' });
  }

  let logContent = '';
  const logFile = item.logFile ? path.join(LOGS_DIR, item.logFile) : null;
  if (logFile && existsSync(logFile)) {
    logContent = readFileSync(logFile, 'utf8');
  } else {
    // If still in active tmux
    try {
      logContent = execFileSync('tmux', ['capture-pane', '-pt', item.sessionName, '-S', '-300'], {
        env: ENV,
        encoding: 'utf8',
        timeout: 2000,
      }).trimEnd();
    } catch {
      logContent = '(보관된 상세 로그가 없습니다.)';
    }
  }

  res.json({ ok: true, item, logContent });
};
app.get('/api/history-log/:id', handleHistoryLog);
app.get('/vibe-maker/api/history-log/:id', handleHistoryLog);

// 6. Direct Screen / Tmux Realtime Status API
const handleScreenLive = (req, res) => {
  const sessions = getActiveSessions();
  if (sessions.length === 0) {
    return res.json({ ok: true, active: false, output: '(현재 백그라운드에서 실행 중인 agy 세션이 없습니다.)' });
  }
  try {
    const output = execFileSync('tmux', ['capture-pane', '-pt', sessions[0], '-S', '-100'], {
      env: ENV,
      encoding: 'utf8',
      timeout: 2000,
    }).trimEnd();
    res.json({ ok: true, active: true, session: sessions[0], output });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
};
app.get('/api/screen-live', handleScreenLive);
app.get('/vibe-maker/api/screen-live', handleScreenLive);

// 7. Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

wss.on("connection", (ws, req) => {
  let timer = setInterval(() => {
    try {
      const sessions = getActiveSessions();
      if (sessions.length === 0) {
        ws.send(JSON.stringify({ type: "status", text: "(현재 실행 중인 바이브 코딩 agy 세션이 없습니다.)", sessions: [] }));
        return;
      }
      const target = sessions[0];
      const pane = execFileSync("tmux", ["capture-pane", "-pt", target, "-S", "-60"], {
        env: ENV,
        encoding: "utf8",
        timeout: 2000,
      }).trimEnd();
      ws.send(JSON.stringify({ type: "stream", session: target, text: pane, sessions }));
    } catch {}
  }, 1500);

  ws.on("close", () => {
    clearInterval(timer);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🎨 Vibe Maker (바이브 제작/수정) 서버 실행 중: http://127.0.0.1:${PORT}`);
});
