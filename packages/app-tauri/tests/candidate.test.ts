import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeCandidate, READ_CHUNK_BYTES, type SelectedFile } from '../src/candidate';
const file: SelectedFile = {id:'selection/scan',name:'scan',path:'/chosen/scan',size:8};
afterEach(()=>vi.unstubAllGlobals());
const partial = (data: number[], range: string) => new Response(new Uint8Array(data),{status:206,headers:{'Content-Range':range}});
describe('原生候选文件的 asset Range 读取',()=>{
  it('以半开区间请求字节，验证协议确实返回该分段',async()=>{
    const fetcher=vi.fn().mockResolvedValue(partial([2,3,4,5],'bytes 2-5/8'));vi.stubGlobal('fetch',fetcher);
    expect(Array.from(new Uint8Array(await nativeCandidate(file,'asset://chosen').read(2,6)))).toEqual([2,3,4,5]);
    expect(fetcher).toHaveBeenCalledWith('asset://chosen',{headers:{Range:'bytes=2-5'},signal:undefined});
  });
  it('全量读取也显式经过本地协议，不走 IPC',async()=>{
    const fetcher=vi.fn().mockResolvedValue(partial([0,1,2,3,4,5,6,7],'bytes 0-7/8'));vi.stubGlobal('fetch',fetcher);
    expect((await nativeCandidate(file,'asset://chosen').read()).byteLength).toBe(8);
    expect(fetcher.mock.calls[0]?.[1].headers.Range).toBe('bytes=0-7');
  });
  it('超过单响应上限时按顺序拼接分块，保留边界像素',async()=>{
    const size=READ_CHUNK_BYTES+3;const input=new Uint8Array(size);input[READ_CHUNK_BYTES-1]=17;input[READ_CHUNK_BYTES]=29;input[size-1]=42;
    const fetcher=vi.fn().mockImplementation((_url: string, options: RequestInit)=>{
      const range=(options.headers as Record<string,string>).Range!;const [start,end]=range.slice(6).split('-').map(Number);
      return Promise.resolve(new Response(input.slice(start,end!+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${size}`}}));
    });vi.stubGlobal('fetch',fetcher);
    const output=new Uint8Array(await nativeCandidate({...file,size},'asset://chosen').read());
    expect(Buffer.from(output).equals(Buffer.from(input))).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('协议忽略 Range 时明确失败，不能把全文件当分段使用',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new Uint8Array(8),{status:200})));
    await expect(nativeCandidate(file,'asset://chosen').read(2,6)).rejects.toThrow('未按范围');
  });
  it('错误 Content-Range 与缺字节均拒绝',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(partial([2,3,4,5],'bytes 0-3/8')).mockResolvedValueOnce(partial([2,3],'bytes 2-5/8')));
    const candidate=nativeCandidate(file,'asset://chosen');
    await expect(candidate.read(2,6)).rejects.toThrow('分段信息');
    await expect(candidate.read(2,6)).rejects.toThrow('字节数');
  });
  it('空范围不发请求，取消/越界在 I/O 前拒绝',async()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const candidate=nativeCandidate(file,'asset://chosen');
    expect((await candidate.read(2,2)).byteLength).toBe(0);
    await expect(candidate.read(-1,3)).rejects.toThrow('范围无效');
    await expect(candidate.read(0,9)).rejects.toThrow('范围无效');
    const controller=new AbortController();controller.abort();
    await expect(candidate.read(0,1,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
