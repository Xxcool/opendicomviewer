/**
 * jpeg-lossless-decoder-js 的最小环境声明
 *
 * 上游包声明了 `types: release/lossless.d.ts` 但实际发布物缺少该文件，
 * 这里只声明本项目用到的部分，避免 `any` 扩散。
 */
declare module 'jpeg-lossless-decoder-js' {
  export class Decoder {
    constructor(buffer?: ArrayBuffer | null, numBytes?: number);
    decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer;
  }
}
