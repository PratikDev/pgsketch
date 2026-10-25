import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ZodError } from 'zod';
import {
  ipcInputs,
  type IpcChannel,
  type IpcInputs,
  type IpcResults,
} from '../../shared/ipc-contract';

/** The part of `ipcMain` that handlers are registered on, so tests can use a stand-in. */
export type IpcRegistry = Pick<IpcMain, 'handle'>;

export type IpcHandler<C extends IpcChannel> = (
  input: IpcInputs[C],
  event: IpcMainInvokeEvent,
) => IpcResults[C] | Promise<IpcResults[C]>;

/** What the renderer gets back for input that doesn't match the channel's schema. */
export class IpcValidationError extends Error {
  constructor(channel: IpcChannel, error: ZodError) {
    // field names and what was wrong, never the values: a password may be among them
    const problems = error.issues
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    super(`Invalid input for "${channel}": ${problems}`);
    this.name = 'IpcValidationError';
  }
}

/**
 * Handles one channel. What the renderer sent is untrusted until it has matched the channel's
 * schema; the handler only ever sees the parsed value, and a mismatch rejects the call before
 * anything runs.
 */
export function registerIpc<C extends IpcChannel>(
  ipc: IpcRegistry,
  channel: C,
  handler: IpcHandler<C>,
): void {
  ipc.handle(channel, async (event, raw: unknown) => {
    const parsed = ipcInputs[channel].safeParse(raw);
    if (!parsed.success) throw new IpcValidationError(channel, parsed.error);
    return handler(parsed.data, event);
  });
}
