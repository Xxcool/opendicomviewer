/** 仅传已授权来源 ID 与大小；影像二进制不经过宿主 IPC。 */
export type HostOriginalSaver = (files: readonly { id: string; size: number }[]) => Promise<'saved' | 'cancelled'>;
