import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface CdpResponse {
  id: number;
  result?: any;
  error?: any;
}

export class PackagedAppDriver {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private msgId = 1;
  private pendingCallbacks = new Map<number, (res: CdpResponse) => void>();
  public exePath = 'D:\\downloads\\Movies\\hacktoberfest\\slothsort\\dist\\package\\win-unpacked\\SlothSort.exe';
  public userDataDir = 'D:\\SlothSort-Phase3B-Test\\profile';

  async launch(options: { port?: number; customEnv?: Record<string, string> } = {}): Promise<void> {
    const port = options.port || 9222;
    console.log(`[PackagedAppDriver] Launching ${this.exePath} on CDP port ${port}...`);

    const env = {
      ...process.env,
      SLOTHSORT_USER_DATA_DIR: this.userDataDir,
      ...options.customEnv
    };

    this.proc = spawn(
      this.exePath,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.userDataDir}`
      ],
      {
        env,
        stdio: 'ignore'
      }
    );

    // Wait for CDP to respond
    let endpoint: string | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        if (res.ok) {
          const list: any = await res.json();
          const page = list.find((p: any) => p.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            endpoint = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {
        // Retry
      }
    }

    if (!endpoint) {
      this.kill();
      throw new Error(`Failed to connect to CDP endpoint on port ${port} within 10 seconds.`);
    }

    console.log(`[PackagedAppDriver] Connected to page: ${endpoint}`);
    await this.connectWs(endpoint);

    // Enable Page and Runtime
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  private connectWs(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString()) as CdpResponse;
          if (data.id && this.pendingCallbacks.has(data.id)) {
            const cb = this.pendingCallbacks.get(data.id)!;
            this.pendingCallbacks.delete(data.id);
            cb(data);
          }
        } catch (e) {
          console.error('[PackagedAppDriver] Error parsing CDP message:', e);
        }
      };
    });
  }

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected.'));
      }
      const id = this.msgId++;
      this.pendingCallbacks.set(id, (res) => {
        if (res.error) {
          reject(new Error(`CDP Error in ${method}: ${JSON.stringify(res.error)}`));
        } else {
          resolve(res.result);
        }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filename: string): Promise<string> {
    const savePath = path.resolve('artifacts', 'phase-3b', 'screenshots', filename);
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    fs.writeFileSync(savePath, buffer);
    console.log(`[PackagedAppDriver] Screenshot saved: ${savePath} (${buffer.length} bytes)`);
    return savePath;
  }

  async close(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.proc) {
      this.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));
      if (!this.proc.killed) {
        this.proc.kill('SIGKILL');
      }
      this.proc = null;
    }
    console.log('[PackagedAppDriver] Process stopped cleanly.');
  }

  kill(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {}
    }
  }
}
