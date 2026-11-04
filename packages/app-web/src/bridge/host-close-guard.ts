/** 原生窗口关闭前由应用确认；返回函数取消宿主订阅。 */
export type HostCloseGuard = (confirm: () => Promise<boolean>) => Promise<() => void>;
