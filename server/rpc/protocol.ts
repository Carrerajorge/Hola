import { encode, decode } from '@msgpack/msgpack';
import * as crypto from 'crypto';

export interface RPCMessage {
    id: string;
    type: 'request' | 'response' | 'event' | 'stream';
    method: string;
    params?: any;
    result?: any;
    error?: { code: number; message: string; data?: any };
    timestamp: number;
    signature?: string;
    channel?: 'vision' | 'control' | 'telemetry' | 'system';
    sequenceId?: number; // for stream chunks
}

const SECRET_KEY = process.env.RPC_SECRET || 'dev-secret-key-1234567890abcdef1234567890abcdef';

export function signPayload(payload: Buffer): string {
    return crypto.createHmac('sha256', SECRET_KEY).update(payload).digest('hex');
}

export function serialize(msg: Omit<RPCMessage, 'signature'>): Buffer {
    const payload = Buffer.from(encode(msg));
    const signature = signPayload(payload);
    const signedMsg: RPCMessage = { ...msg, signature };
    return Buffer.from(encode(signedMsg));
}

export function deserialize(buffer: Buffer): RPCMessage {
    const msg = decode(buffer) as RPCMessage;
    if (!msg.signature) {
        throw new Error("Missing signature");
    }

    const tempMsg = { ...msg };
    delete tempMsg.signature;
    const payload = Buffer.from(encode(tempMsg));
    const expectedSig = signPayload(payload);

    // Vulnerability protection: Constant-time comparison
    const sigBuf = Buffer.from(msg.signature, 'hex');
    const expectedSigBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
        throw new Error("Invalid signature");
    }
    return msg;
}
