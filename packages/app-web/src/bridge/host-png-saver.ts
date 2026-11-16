/** 宿主直接消费 Blob 下载，不通过 IPC 传递像素或 base64。 */
export type HostPngSaver = (blob: Blob, signal?: AbortSignal, documentType?: 'gsps' | 'sr' | 'results') => Promise<'saved' | 'cancelled'>;
