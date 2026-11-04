/** saved 必须表示宿主已完成写入；仅发起浏览器下载不能当作已保存。 */
export type HostFileSaver = (file: { name: string; mimeType: string; text: string }) => Promise<'saved' | 'cancelled' | 'download-started'>;
