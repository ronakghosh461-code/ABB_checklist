const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let publicUrl = null;
let tunnelProcess = null;

function startCloudflareTunnel(port = 3000) {
  const binaryPath = path.join(__dirname, 'bin', 'cloudflared.exe');
  if (!fs.existsSync(binaryPath)) {
    console.warn('[Tunnel] cloudflared.exe not found at:', binaryPath);
    return null;
  }

  console.log('[Tunnel] Starting Cloudflare Quick Tunnel on port ' + port + '...');

  // Spawn cloudflared tunnel
  tunnelProcess = spawn(binaryPath, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
    windowsHide: true
  });

  const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(urlRegex);
    if (match && !publicUrl) {
      publicUrl = match[0];
      console.log('===================================================');
      console.log('🌐 PUBLIC WORLDWIDE URL GENERATED (Accessible on ANY phone/4G/5G):');
      console.log('👉 ' + publicUrl + '/?site=Site-Inspection');
      console.log('===================================================');
    }
  };

  tunnelProcess.stdout.on('data', handleOutput);
  tunnelProcess.stderr.on('data', handleOutput);

  tunnelProcess.on('error', (err) => {
    console.warn('[Tunnel] Cloudflare process error:', err.message);
  });

  tunnelProcess.on('exit', (code) => {
    console.log('[Tunnel] Cloudflare process exited with code:', code);
    publicUrl = null;
  });

  return tunnelProcess;
}

function getPublicUrl() {
  return publicUrl;
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch (e) {}
    tunnelProcess = null;
    publicUrl = null;
  }
}

module.exports = {
  startCloudflareTunnel,
  getPublicUrl,
  stopTunnel
};
