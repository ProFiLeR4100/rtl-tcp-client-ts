import * as net from 'node:net';

export interface MockServerOptions {
  tunerType?: number;
  tunerGainCount?: number;
  /** Override the 4-byte handshake magic (default "RTL0"). */
  magic?: string;
}

export class MockRtlTcpServer {
  private server?: net.Server;
  private socket?: net.Socket;
  private commandBuf = Buffer.alloc(0);
  private opts: { tunerType: number; tunerGainCount: number; magic: string };
  public port = 0;
  public commands: Buffer[] = [];

  constructor(opts: MockServerOptions = {}) {
    this.opts = {
      tunerType: opts.tunerType ?? 5,
      tunerGainCount: opts.tunerGainCount ?? 10,
      magic: opts.magic ?? 'RTL0',
    };
  }

  get receivedCommands(): Buffer[] { return this.commands; }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.socket = socket;
        this.commandBuf = Buffer.alloc(0);
        socket.on('error', () => {});
        const hs = Buffer.alloc(12);
        hs.write(this.opts.magic.slice(0, 4).padEnd(4, '0'), 0, 'ascii');
        hs.writeUInt32BE(this.opts.tunerType, 4);
        hs.writeUInt32BE(this.opts.tunerGainCount, 8);
        socket.write(hs);

        socket.on('data', (chunk: Buffer) => {
          this.commandBuf = Buffer.concat([this.commandBuf, chunk]);
          while (this.commandBuf.length >= 5) {
            this.commands.push(Buffer.from(this.commandBuf.subarray(0, 5)));
            this.commandBuf = Buffer.from(this.commandBuf.subarray(5));
          }
        });
      });
      this.server = server;
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.port = (server.address() as net.AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  sendIq(buf: Buffer): void { this.socket?.write(buf); }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket?.destroy();
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }
}