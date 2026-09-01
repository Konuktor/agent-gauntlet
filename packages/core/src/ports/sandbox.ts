export interface SandboxCreateOptions {
  template?: string
  timeoutMs?: number
  cpu?: number
  memMb?: number
  envs?: Record<string, string>
  metadata?: Record<string, string>
  /** Boot from a snapshot instead of the golden template — how we skip a
   *  repeated `npm install` across repetitions. */
  fromSnapshot?: string
  signal?: AbortSignal
}

export interface CommandOptions {
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface CommandOutput {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
}

export interface BackgroundProcess {
  readonly id: string
  wait(): Promise<number>
  kill(): Promise<void>
}

export interface GitCloneOptions {
  path: string
  branch?: string
  depth?: number
}

export interface SandboxEnvironment {
  readonly sandboxId: string
  writeFile(path: string, content: string | Uint8Array, mode?: number): Promise<void>
  readFile(path: string): Promise<string>
  /**
   * Run a command. `command` is the binary and `args` its argv — there is NO
   * shell. For shell syntax the caller must ask for one explicitly:
   * `run("sh", { args: ["-c", "..."] })`.
   */
  run(command: string, options?: CommandOptions): Promise<CommandOutput>
  startBackground(command: string, options?: CommandOptions): Promise<BackgroundProcess>
  gitClone(url: string, options: GitCloneOptions): Promise<void>
  /** Public URL for a port listening inside the guest. */
  previewUrl(port: number): Promise<string>
  snapshot(name?: string): Promise<string>
  /** Destroy the remote VM. `close()` alone would only drop the local control
   *  channel and leave the machine billing until its idle timeout. */
  dispose(): Promise<void>
}

export interface SandboxProvider {
  readonly mode: "solari" | "local"
  create(options?: SandboxCreateOptions): Promise<SandboxEnvironment>
  shutdown(): Promise<void>
}
