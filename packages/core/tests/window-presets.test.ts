import { describe, expect, it } from 'vitest';
import { getWindowPresets, normalizeBodyPart, pickAdaptiveVOI, WINDOW_PRESETS_BY_BODYPART } from '../pipeline/window-presets';
import type { PixelFrame } from '../domain/types';
const frame = (values: number[], more: Partial<PixelFrame> = {}): PixelFrame => ({ width: values.length, height: 1, pixelData: new Int16Array(values), rescaleSlope: 1, rescaleIntercept: 0, ...more });
describe('部位与自动窗', () => {
  it.each([['CHEST','胸部'],[' c-spine ','脊柱'],['HEAD','头颅'],['LIVER','腹部'],['KNEE','四肢'],['UNKNOWN','未识别'],['','未识别']])('归一 %s', (input, output) => expect(normalizeBodyPart(input)).toBe(output));
  it('CT 按部位选择；MR/CR/DX 不暴露 CT 窗值', () => {
    const meta = { studyInstanceUid: 's', seriesInstanceUid:'v', seriesDescription:'', numberOfFrames:0, spacing:[1,1,1] as [number,number,number], warnings:[], planes:[] };
    expect(getWindowPresets({...meta,modality:'CT'})).toBe(WINDOW_PRESETS_BY_BODYPART.未识别);
    for(const modality of ['MR','CR','DX']) expect(getWindowPresets({...meta,modality})).toEqual([]);
    expect(WINDOW_PRESETS_BY_BODYPART.头颅[0]?.voi).toEqual({windowWidth:80,windowCenter:40});
  });
  it('有效标签优先，包括宽度为 1 的窗', () => {
    expect(pickAdaptiveVOI(frame([0,1000],{defaultVOI:{windowWidth:1,windowCenter:0}}))).toEqual({voi:{windowWidth:1,windowCenter:0},estimated:false});
  });
  it('估算在物理强度域执行；CT 空气和水不重复应用重标定', () => {
    expect(pickAdaptiveVOI(frame([0,1024],{rescaleIntercept:-1024}))).toEqual({voi:{windowWidth:1025,windowCenter:-511.5},estimated:true});
    expect(pickAdaptiveVOI(frame([0,1],{rescaleSlope:100,modalityLUT:{firstMappedPixelValue:0,bitsStored:16,lutData:[10,20]}})).voi).toEqual({windowWidth:11,windowCenter:15.5});
  });
  it('2%–98% 去除两端离群值，原像素不变', () => {
    const source = frame([-30000,...Array.from({length:98},(_,i)=>i),30000]);
    expect(pickAdaptiveVOI(source).voi).toEqual({windowWidth:96,windowCenter:49});
    expect(source.pixelData[0]).toBe(-30000);
  });
  it('无效标签、分位塌缩使用 min/max；常量窗和空值边界明确', () => {
    expect(pickAdaptiveVOI(frame([...Array(99).fill(0),100],{defaultVOI:{windowWidth:-1,windowCenter:NaN}})).voi).toEqual({windowWidth:101,windowCenter:50.5});
    expect(pickAdaptiveVOI(frame([7,7])).voi).toEqual({windowWidth:1,windowCenter:7.5});
    expect(()=>pickAdaptiveVOI(frame([]))).toThrow('没有有效像素');
  });
});
