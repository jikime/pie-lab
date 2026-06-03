export interface RtkHit {
    shape: string;
    filter: string;
    saved: number;
}
export interface RtkStats {
    bytesBefore: number;
    bytesAfter: number;
    hits: RtkHit[];
}
export interface RtkPayloadResult {
    payload: unknown;
    stats: RtkStats | null;
    logLine: string | null;
}
export declare function compressPayloadWithRtk(payload: unknown, enabled?: boolean): RtkPayloadResult;
export declare function compressMessages(body: unknown, enabled?: boolean): RtkStats | null;
export declare function formatRtkLog(stats: RtkStats | null): string | null;
//# sourceMappingURL=rtk.d.ts.map