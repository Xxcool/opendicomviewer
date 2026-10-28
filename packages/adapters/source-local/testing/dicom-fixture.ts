/**
 * DICOM Fixture Builder（测试与验证专用合成工具）
 *
 * 严格遵循规范：
 * 不下载外部数据集，不使用真实患者数据。
 * 支持合成带 "DICM" 前缀的标准文件流、显式 VR 元素编码，以及可控畸形样本生成。
 */

export interface DicomFixtureElement {
  readonly tag: [number, number]; // [group, element]
  readonly vr: string;
  readonly value: string | number | Uint8Array | [number, number, number];
}

export interface DicomFixtureOptions {
  readonly skipPreamble?: boolean;
  readonly invalidMagic?: boolean;
  readonly truncateBytes?: number;
  readonly specificCharacterSet?: string;
  readonly patientName?: string | Uint8Array;
  readonly patientId?: string;
  readonly studyInstanceUid?: string;
  readonly seriesInstanceUid?: string;
  readonly sopInstanceUid?: string;
  readonly sopClassUid?: string;
  readonly modality?: string;
  readonly instanceNumber?: number;
  readonly imagePositionPatient?: [number, number, number];
  readonly imageOrientationPatient?: [number, number, number, number, number, number];
  readonly pixelSpacing?: [number, number];
  readonly rows?: number;
  readonly columns?: number;
  readonly transferSyntaxUid?: string;
  readonly omitImagePositionPatient?: boolean;
  readonly omitImageOrientationPatient?: boolean;
  /** 原始像素字节（小端、逐像素紧排）。提供后才会写入完整 Image Pixel 模块与 (7FE0,0010) */
  readonly pixelData?: Uint8Array;
  readonly bitsAllocated?: number;
  readonly bitsStored?: number;
  readonly pixelRepresentation?: number;
  readonly samplesPerPixel?: number;
  readonly photometricInterpretation?: string;
  readonly rescaleSlope?: number;
  readonly rescaleIntercept?: number;
  readonly windowCenter?: number;
  readonly windowWidth?: number;
  readonly extraElements?: readonly DicomFixtureElement[];
}

function writeUint16LE(bytes: number[], val: number): void {
  bytes.push(val & 0xff, (val >> 8) & 0xff);
}

function writeUint32LE(bytes: number[], val: number): void {
  bytes.push(
    val & 0xff,
    (val >> 8) & 0xff,
    (val >> 16) & 0xff,
    (val >> 24) & 0xff,
  );
}

function writeString(bytes: number[], str: string): void {
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i) & 0xff);
  }
}

const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'UC', 'UR']);

/**
 * 编码单个 Explicit VR 小端元素
 */
export function encodeElement(
  group: number,
  element: number,
  vr: string,
  data: Uint8Array,
): number[] {
  const bytes: number[] = [];
  writeUint16LE(bytes, group);
  writeUint16LE(bytes, element);
  writeString(bytes, vr);

  const length = data.length;
  const isOdd = length % 2 !== 0;
  const totalLength = isOdd ? length + 1 : length;

  if (LONG_VRS.has(vr)) {
    writeUint16LE(bytes, 0); // 保留字 2 字节
    writeUint32LE(bytes, totalLength);
  } else {
    writeUint16LE(bytes, totalLength);
  }

  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b !== undefined) bytes.push(b);
  }

  // 奇数长度根据 DICOM 规范填充：文本 VR 填 0x20，二进制 VR 必须填 0x00
  if (isOdd) {
    const isTextVr = vr === 'UI' || vr === 'CS' || vr === 'LO' || vr === 'PN' ||
      vr === 'DS' || vr === 'IS' || vr === 'SH' || vr === 'LT' || vr === 'ST' ||
      vr === 'UT' || vr === 'AE' || vr === 'AS' || vr === 'DA' || vr === 'TM' ||
      vr === 'DT' || vr === 'TM';
    bytes.push(isTextVr ? 0x20 : 0x00);
  }

  return bytes;
}

export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * 构建完整的 DICOM 字节流
 */
export function buildDicomBuffer(options: DicomFixtureOptions = {}): Uint8Array {
  const result: number[] = [];

  // 1. 128 字节 Preamble
  if (!options.skipPreamble) {
    for (let i = 0; i < 128; i++) {
      result.push(0);
    }
  }

  // 2. 4 字节魔数
  if (options.invalidMagic) {
    writeString(result, 'NOPE');
  } else {
    writeString(result, 'DICM');
  }

  // 3. File Meta Information 组 (0002)
  const metaElements: number[] = [];

  // (0002,0001) File Meta Information Version
  metaElements.push(
    ...encodeElement(0x0002, 0x0001, 'OB', new Uint8Array([0x00, 0x01])),
  );

  // (0002,0002) Media Storage SOP Class UID
  const sopClassUid = options.sopClassUid ?? '1.2.840.10008.5.1.4.1.1.2';
  metaElements.push(
    ...encodeElement(0x0002, 0x0002, 'UI', stringToBytes(sopClassUid)),
  );

  // (0002,0003) Media Storage SOP Instance UID
  const sopInstanceUid =
    options.sopInstanceUid ?? '1.2.840.10008.5.1.4.1.1.2.1.999';
  metaElements.push(
    ...encodeElement(0x0002, 0x0003, 'UI', stringToBytes(sopInstanceUid)),
  );

  // (0002,0010) Transfer Syntax UID: 默认 Explicit VR Little Endian
  const transferSyntaxUid =
    options.transferSyntaxUid ?? '1.2.840.10008.1.2.1';
  metaElements.push(
    ...encodeElement(
      0x0002,
      0x0010,
      'UI',
      stringToBytes(transferSyntaxUid),
    ),
  );

  // (0002,0000) File Meta Information Group Length
  const metaGroupLenBytes: number[] = [];
  writeUint32LE(metaGroupLenBytes, metaElements.length);
  result.push(
    ...encodeElement(
      0x0002,
      0x0000,
      'UL',
      new Uint8Array(metaGroupLenBytes),
    ),
  );
  result.push(...metaElements);

  // 4. 数据集组元素
  const dsElements: number[] = [];

  // (0008,0005) Specific Character Set
  if (options.specificCharacterSet !== undefined) {
    dsElements.push(
      ...encodeElement(
        0x0008,
        0x0005,
        'CS',
        stringToBytes(options.specificCharacterSet),
      ),
    );
  }

  // (0008,0016) SOP Class UID
  dsElements.push(
    ...encodeElement(0x0008, 0x0016, 'UI', stringToBytes(sopClassUid)),
  );

  // (0008,0018) SOP Instance UID
  dsElements.push(
    ...encodeElement(0x0008, 0x0018, 'UI', stringToBytes(sopInstanceUid)),
  );

  // (0008,0060) Modality
  dsElements.push(
    ...encodeElement(
      0x0008,
      0x0060,
      'CS',
      stringToBytes(options.modality ?? 'CT'),
    ),
  );

  // (0010,0010) Patient Name
  if (options.patientName !== undefined) {
    const pnBytes =
      typeof options.patientName === 'string'
        ? stringToBytes(options.patientName)
        : options.patientName;
    dsElements.push(...encodeElement(0x0010, 0x0010, 'PN', pnBytes));
  }

  // (0010,0020) Patient ID
  dsElements.push(
    ...encodeElement(
      0x0010,
      0x0020,
      'LO',
      stringToBytes(options.patientId ?? 'PID-12345'),
    ),
  );

  // (0020,000D) Study Instance UID
  dsElements.push(
    ...encodeElement(
      0x0020,
      0x000d,
      'UI',
      stringToBytes(options.studyInstanceUid ?? '1.2.840.10008.1.1.1'),
    ),
  );

  // (0020,000E) Series Instance UID
  dsElements.push(
    ...encodeElement(
      0x0020,
      0x000e,
      'UI',
      stringToBytes(options.seriesInstanceUid ?? '1.2.840.10008.1.1.2'),
    ),
  );

  // (0020,0013) Instance Number
  const instNum = options.instanceNumber ?? 1;
  dsElements.push(
    ...encodeElement(0x0020, 0x0013, 'IS', stringToBytes(String(instNum))),
  );

  // (0020,0032) Image Position Patient
  if (!options.omitImagePositionPatient) {
    const ipp = options.imagePositionPatient ?? [0, 0, 0];
    dsElements.push(
      ...encodeElement(
        0x0020,
        0x0032,
        'DS',
        stringToBytes(`${ipp[0]}\\${ipp[1]}\\${ipp[2]}`),
      ),
    );
  }

  // (0020,0037) Image Orientation Patient
  if (!options.omitImageOrientationPatient) {
    const iop = options.imageOrientationPatient ?? [1, 0, 0, 0, 1, 0];
    dsElements.push(
      ...encodeElement(
        0x0020,
        0x0037,
        'DS',
        stringToBytes(`${iop[0]}\\${iop[1]}\\${iop[2]}\\${iop[3]}\\${iop[4]}\\${iop[5]}`),
      ),
    );
  }

  // (0028,0010) Rows
  const rowsBytes: number[] = [];
  writeUint16LE(rowsBytes, options.rows ?? 512);
  dsElements.push(
    ...encodeElement(0x0028, 0x0010, 'US', new Uint8Array(rowsBytes)),
  );

  // (0028,0011) Columns
  const colsBytes: number[] = [];
  writeUint16LE(colsBytes, options.columns ?? 512);
  dsElements.push(
    ...encodeElement(0x0028, 0x0011, 'US', new Uint8Array(colsBytes)),
  );

  // (0028,0030) Pixel Spacing
  const ps = options.pixelSpacing ?? [0.7, 0.7];
  dsElements.push(
    ...encodeElement(0x0028, 0x0030, 'DS', stringToBytes(`${ps[0]}\\${ps[1]}`)),
  );

  // Image Pixel 模块：仅在提供像素数据时写入，避免影响纯元数据用例
  if (options.pixelData) {
    const pushUS = (element: number, value: number): void => {
      const b: number[] = [];
      writeUint16LE(b, value);
      dsElements.push(...encodeElement(0x0028, element, 'US', new Uint8Array(b)));
    };
    const pushDS = (element: number, value: number): void => {
      dsElements.push(
        ...encodeElement(0x0028, element, 'DS', stringToBytes(String(value))),
      );
    };

    pushUS(0x0002, options.samplesPerPixel ?? 1);
    dsElements.push(
      ...encodeElement(
        0x0028,
        0x0004,
        'CS',
        stringToBytes(options.photometricInterpretation ?? 'MONOCHROME2'),
      ),
    );

    const bitsAllocated = options.bitsAllocated ?? 16;
    pushUS(0x0100, bitsAllocated);
    pushUS(0x0101, options.bitsStored ?? bitsAllocated);
    pushUS(0x0102, (options.bitsStored ?? bitsAllocated) - 1);
    pushUS(0x0103, options.pixelRepresentation ?? 0);

    if (options.rescaleIntercept !== undefined) {
      pushDS(0x1052, options.rescaleIntercept);
    }
    if (options.rescaleSlope !== undefined) {
      pushDS(0x1053, options.rescaleSlope);
    }
    if (options.windowCenter !== undefined) {
      pushDS(0x1050, options.windowCenter);
    }
    if (options.windowWidth !== undefined) {
      pushDS(0x1051, options.windowWidth);
    }
  }

  // 用户额外指定的元素
  if (options.extraElements) {
    for (const elem of options.extraElements) {
      let valBytes: Uint8Array;
      if (elem.value instanceof Uint8Array) {
        valBytes = elem.value;
      } else if (typeof elem.value === 'string') {
        valBytes = stringToBytes(elem.value);
      } else if (typeof elem.value === 'number') {
        const numBytes: number[] = [];
        if (elem.vr === 'US') writeUint16LE(numBytes, elem.value);
        else writeUint32LE(numBytes, elem.value);
        valBytes = new Uint8Array(numBytes);
      } else {
        valBytes = stringToBytes(`${elem.value[0]}\\${elem.value[1]}\\${elem.value[2]}`);
      }
      dsElements.push(...encodeElement(elem.tag[0], elem.tag[1], elem.vr, valBytes));
    }
  }

  // (7FE0,0010) Pixel Data 必须排在最后
  if (options.pixelData) {
    dsElements.push(
      ...encodeElement(
        0x7fe0,
        0x0010,
        (options.bitsAllocated ?? 16) > 8 ? 'OW' : 'OB',
        options.pixelData,
      ),
    );
  }

  result.push(...dsElements);

  const fullBytes = new Uint8Array(result);
  if (options.truncateBytes !== undefined) {
    return fullBytes.slice(0, options.truncateBytes);
  }
  return fullBytes;
}

export interface DicomdirRecordFixture {
  readonly recordType: 'PATIENT' | 'STUDY' | 'SERIES' | 'IMAGE';
  readonly patientId?: string;
  readonly patientName?: string;
  readonly studyInstanceUid?: string;
  readonly studyDescription?: string;
  readonly seriesInstanceUid?: string;
  readonly modality?: string;
  readonly referencedFileId?: string;
  readonly referencedSopInstanceUid?: string;
  readonly nextRecordOffset?: number;
  readonly lowerLevelOffset?: number;
}

export interface DicomdirOptions {
  readonly rootOffset?: number;
}

/**
 * 构建符合 DICOM 标准的 DICOMDIR 索引文件字节流
 */
export function buildDicomdirBuffer(
  records: readonly DicomdirRecordFixture[],
  options?: DicomdirOptions,
): Uint8Array {
  const result: number[] = [];

  // 128 字节 Preamble + DICM
  for (let i = 0; i < 128; i++) {
    result.push(0);
  }
  writeString(result, 'DICM');

  // File Meta Information
  const metaElements: number[] = [];
  metaElements.push(
    ...encodeElement(
      0x0002,
      0x0002,
      'UI',
      stringToBytes('1.2.840.10008.1.3.10'), // Media Storage Directory Storage
    ),
  );
  metaElements.push(
    ...encodeElement(
      0x0002,
      0x0003,
      'UI',
      stringToBytes('1.2.840.10008.1.3.10.1.1'),
    ),
  );
  metaElements.push(
    ...encodeElement(
      0x0002,
      0x0010,
      'UI',
      stringToBytes('1.2.840.10008.1.2.1'), // Explicit VR LE
    ),
  );

  const metaGroupLenBytes: number[] = [];
  writeUint32LE(metaGroupLenBytes, metaElements.length);
  result.push(
    ...encodeElement(0x0002, 0x0000, 'UL', new Uint8Array(metaGroupLenBytes)),
  );
  result.push(...metaElements);

  // (0004,1200) Offset of the First Directory Record of the Root Directory Entity
  if (options?.rootOffset !== undefined) {
    const rootOffsetBytes: number[] = [];
    writeUint32LE(rootOffsetBytes, options.rootOffset);
    result.push(
      ...encodeElement(0x0004, 0x1200, 'UL', new Uint8Array(rootOffsetBytes)),
    );
  }

  // Group 0004: DirectoryRecordSequence (0004,1220)
  const allItemsBytes: number[] = [];

  for (const rec of records) {
    const itemElements: number[] = [];

    // (0004,1400) Offset of the Next Directory Record
    if (rec.nextRecordOffset !== undefined) {
      const nextOffsetBytes: number[] = [];
      writeUint32LE(nextOffsetBytes, rec.nextRecordOffset);
      itemElements.push(
        ...encodeElement(0x0004, 0x1400, 'UL', new Uint8Array(nextOffsetBytes)),
      );
    }

    // (0004,1410) Offset of Referenced Lower-Level Directory Entity
    if (rec.lowerLevelOffset !== undefined) {
      const lowerOffsetBytes: number[] = [];
      writeUint32LE(lowerOffsetBytes, rec.lowerLevelOffset);
      itemElements.push(
        ...encodeElement(0x0004, 0x1410, 'UL', new Uint8Array(lowerOffsetBytes)),
      );
    }

    // (0004,1430) Directory Record Type
    itemElements.push(
      ...encodeElement(0x0004, 0x1430, 'CS', stringToBytes(rec.recordType)),
    );

    if (rec.recordType === 'PATIENT') {
      itemElements.push(
        ...encodeElement(
          0x0010,
          0x0020,
          'LO',
          stringToBytes(rec.patientId ?? 'DIR-PID'),
        ),
      );
      if (rec.patientName) {
        itemElements.push(
          ...encodeElement(0x0010, 0x0010, 'PN', stringToBytes(rec.patientName)),
        );
      }
    } else if (rec.recordType === 'STUDY') {
      itemElements.push(
        ...encodeElement(
          0x0020,
          0x000d,
          'UI',
          stringToBytes(rec.studyInstanceUid ?? '1.2.3.1'),
        ),
      );
      if (rec.studyDescription) {
        itemElements.push(
          ...encodeElement(
            0x0008,
            0x1030,
            'LO',
            stringToBytes(rec.studyDescription),
          ),
        );
      }
    } else if (rec.recordType === 'SERIES') {
      itemElements.push(
        ...encodeElement(
          0x0020,
          0x000e,
          'UI',
          stringToBytes(rec.seriesInstanceUid ?? '1.2.3.1.1'),
        ),
      );
      itemElements.push(
        ...encodeElement(
          0x0008,
          0x0060,
          'CS',
          stringToBytes(rec.modality ?? 'CT'),
        ),
      );
    } else if (rec.recordType === 'IMAGE') {
      if (rec.referencedFileId) {
        itemElements.push(
          ...encodeElement(
            0x0004,
            0x1500,
            'CS',
            stringToBytes(rec.referencedFileId),
          ),
        );
      }
      if (rec.referencedSopInstanceUid) {
        itemElements.push(
          ...encodeElement(
            0x0004,
            0x1511,
            'UI',
            stringToBytes(rec.referencedSopInstanceUid),
          ),
        );
      }
    }

    // Sequence Item: FFFE E000, Length (4 bytes LE)
    allItemsBytes.push(0xfe, 0xff, 0x00, 0xe0);
    writeUint32LE(allItemsBytes, itemElements.length);
    allItemsBytes.push(...itemElements);
  }

  // Sequence Element (0004,1220)
  result.push(
    ...encodeElement(0x0004, 0x1220, 'SQ', new Uint8Array(allItemsBytes)),
  );

  return new Uint8Array(result);
}
