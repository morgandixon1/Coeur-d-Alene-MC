type NbtByte = { type: "byte"; value: number };
type NbtShort = { type: "short"; value: number };
type NbtInt = { type: "int"; value: number };
type NbtLong = { type: "long"; value: bigint };
type NbtFloat = { type: "float"; value: number };
type NbtString = { type: "string"; value: string };
type NbtCompound = { type: "compound"; value: Record<string, NbtValue> };
type NbtList = { type: "list"; itemType: NbtValue["type"]; items: NbtValue[] };

export type NbtValue =
  | NbtByte
  | NbtShort
  | NbtInt
  | NbtLong
  | NbtFloat
  | NbtString
  | NbtCompound
  | NbtList;

export const byte = (value: number): NbtByte => ({ type: "byte", value });
export const short = (value: number): NbtShort => ({ type: "short", value });
export const int = (value: number): NbtInt => ({ type: "int", value });
export const long = (value: bigint | number): NbtLong => ({
  type: "long",
  value: typeof value === "bigint" ? value : BigInt(value),
});
export const float = (value: number): NbtFloat => ({ type: "float", value });
export const str = (value: string): NbtString => ({ type: "string", value });
export const compound = (value: Record<string, NbtValue>): NbtCompound => ({ type: "compound", value });
export const list = (itemType: NbtValue["type"], items: NbtValue[]): NbtList => ({
  type: "list",
  itemType,
  items,
});
export const intList = (values: number[]): NbtList => ({
  type: "list",
  itemType: "int",
  items: values.map((value) => int(value)),
});

const TYPE_CODE: Record<NbtValue["type"], number> = {
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  string: 8,
  list: 9,
  compound: 10,
};

class Bytes {
  private readonly chunks: Buffer[] = [];

  u8(value: number) {
    this.chunks.push(Buffer.from([value & 0xff]));
  }

  u16(value: number) {
    const buf = Buffer.allocUnsafe(2);
    buf.writeUInt16LE(value & 0xffff, 0);
    this.chunks.push(buf);
  }

  i16(value: number) {
    const buf = Buffer.allocUnsafe(2);
    buf.writeInt16LE(value, 0);
    this.chunks.push(buf);
  }

  i32(value: number) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeInt32LE(value | 0, 0);
    this.chunks.push(buf);
  }

  i64(value: bigint) {
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigInt64LE(value, 0);
    this.chunks.push(buf);
  }

  f32(value: number) {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatLE(value, 0);
    this.chunks.push(buf);
  }

  raw(value: Buffer) {
    this.chunks.push(value);
  }

  utf(value: string) {
    const body = Buffer.from(value, "utf8");
    this.u16(body.length);
    if (body.length > 0) this.raw(body);
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function writePayload(value: NbtValue, out: Bytes) {
  switch (value.type) {
    case "byte":
      out.u8(value.value);
      break;
    case "short":
      out.i16(value.value);
      break;
    case "int":
      out.i32(value.value);
      break;
    case "long":
      out.i64(value.value);
      break;
    case "float":
      out.f32(value.value);
      break;
    case "string":
      out.utf(value.value);
      break;
    case "list": {
      out.u8(TYPE_CODE[value.itemType]);
      out.i32(value.items.length);
      for (const item of value.items) writePayload(item, out);
      break;
    }
    case "compound": {
      for (const [name, child] of Object.entries(value.value)) {
        out.u8(TYPE_CODE[child.type]);
        out.utf(name);
        writePayload(child, out);
      }
      out.u8(0);
      break;
    }
    default: {
      const unreachable: never = value;
      throw new Error(`Unsupported NBT value ${String(unreachable)}`);
    }
  }
}

/** Little-endian named compound, the Bedrock on-disk NBT root. */
export function writeRoot(value: Record<string, NbtValue>): Buffer {
  const out = new Bytes();
  out.u8(TYPE_CODE.compound);
  out.utf("");
  writePayload(compound(value), out);
  return out.finish();
}
