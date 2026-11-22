export type Nbt = string | number | bigint | Nbt[] | { [key: string]: Nbt } | Uint8Array;

function readString(buf: Buffer, offset: number): { value: string; offset: number } {
  const length = buf.readUInt16LE(offset);
  const start = offset + 2;
  return { value: buf.toString("utf8", start, start + length), offset: start + length };
}

function readPayload(buf: Buffer, offset: number, type: number): { value: Nbt; offset: number } {
  switch (type) {
    case 1:
      return { value: buf.readInt8(offset), offset: offset + 1 };
    case 2:
      return { value: buf.readInt16LE(offset), offset: offset + 2 };
    case 3:
      return { value: buf.readInt32LE(offset), offset: offset + 4 };
    case 4:
      return { value: buf.readBigInt64LE(offset), offset: offset + 8 };
    case 5:
      return { value: buf.readFloatLE(offset), offset: offset + 4 };
    case 6:
      return { value: buf.readDoubleLE(offset), offset: offset + 8 };
    case 7: {
      const length = buf.readInt32LE(offset);
      const start = offset + 4;
      return { value: buf.subarray(start, start + length), offset: start + length };
    }
    case 8:
      return readString(buf, offset);
    case 9: {
      const itemType = buf.readUInt8(offset);
      const count = buf.readInt32LE(offset + 1);
      const items: Nbt[] = [];
      let cursor = offset + 5;
      for (let i = 0; i < count; i += 1) {
        const item = readPayload(buf, cursor, itemType);
        items.push(item.value);
        cursor = item.offset;
      }
      return { value: items, offset: cursor };
    }
    case 10: {
      const value: { [key: string]: Nbt } = {};
      let cursor = offset;
      while (cursor < buf.length) {
        const childType = buf.readUInt8(cursor);
        cursor += 1;
        if (childType === 0) break;
        const name = readString(buf, cursor);
        const child = readPayload(buf, name.offset, childType);
        value[name.value] = child.value;
        cursor = child.offset;
      }
      return { value, offset: cursor };
    }
    case 11: {
      const length = buf.readInt32LE(offset);
      return { value: length, offset: offset + 4 + length * 4 };
    }
    case 12: {
      const length = buf.readInt32LE(offset);
      return { value: length, offset: offset + 4 + length * 8 };
    }
    default:
      throw new Error(`Unknown NBT type ${type} at ${offset}`);
  }
}

export function readNamedCompound(buf: Buffer, offset: number): { value: { [key: string]: Nbt }; offset: number } {
  const type = buf.readUInt8(offset);
  if (type !== 10) throw new Error(`Expected a compound tag at ${offset}`);
  const name = readString(buf, offset + 1);
  const body = readPayload(buf, name.offset, 10);
  return { value: body.value as { [key: string]: Nbt }, offset: body.offset };
}
