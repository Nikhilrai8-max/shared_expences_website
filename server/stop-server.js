import fs from 'fs';
import path from 'path';

const PID_FILE = path.resolve(process.cwd(), 'dev.pid');

async function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.error('PID file not found at', PID_FILE);
    process.exit(1);
  }

  const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) {
    console.error('Invalid PID in PID file:', pidStr);
    process.exit(1);
  }

  try {
    process.kill(pid);
    console.log(`Sent kill to PID ${pid}`);
    try { fs.unlinkSync(PID_FILE); } catch (e) {}
    process.exit(0);
  } catch (err) {
    console.error('process.kill failed:', err.message);
    // Fallback to taskkill on Windows
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        execSync(`taskkill /PID ${pid} /F`);
        console.log(`taskkill succeeded for ${pid}`);
        try { fs.unlinkSync(PID_FILE); } catch (e) {}
        process.exit(0);
      } catch (e) {
        console.error('taskkill failed:', e.message);
        process.exit(1);
      }
    }
    process.exit(1);
  }
}

main();
