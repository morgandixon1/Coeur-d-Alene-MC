"""Turn each USGS one-meter lidar GeoTIFF into a raw little-endian int16 grid of decimeters.

The TypeScript tiler reads windows from these with plain file reads, which is far faster than
decoding LZW-compressed floats in JavaScript. NODATA is -32768. Rerunning skips finished files.
"""

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import tifffile

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "sources")
LIDAR = os.path.join(ROOT, "lidar")
RAW = os.path.join(ROOT, "lidar-raw")
NODATA = -32768


def convert(name: str) -> str:
    base = name[: -len(".tif")]
    out = os.path.join(RAW, base + ".i16")
    meta_path = os.path.join(RAW, base + ".json")
    if os.path.exists(meta_path):
        return f"have {base}"
    with tifffile.TiffFile(os.path.join(LIDAR, name)) as tif:
        page = tif.pages[0]
        tie = page.tags["ModelTiepointTag"].value
        scale = page.tags["ModelPixelScaleTag"].value
        nodata = float(page.tags["GDAL_NODATA"].value.strip("\x00 ")) if "GDAL_NODATA" in page.tags else -999999.0
        data = page.asarray()
    valid = np.isfinite(data) & (data != nodata) & (data > -500) & (data < 3000)
    decimeters = np.full(data.shape, NODATA, dtype="<i2")
    decimeters[valid] = np.round(data[valid] * 10).astype("<i2")
    tmp = out + ".part"
    decimeters.tofile(tmp)
    os.replace(tmp, out)
    meta = {
        "west": round(tie[3] - tie[0] * scale[0]),
        "north": round(tie[4] + tie[1] * scale[1]),
        "width": int(data.shape[1]),
        "height": int(data.shape[0]),
        "valid": float(valid.mean()),
        "min": float(data[valid].min()) if valid.any() else None,
        "max": float(data[valid].max()) if valid.any() else None,
    }
    with open(meta_path, "w") as handle:
        json.dump(meta, handle)
    return f"made {base} valid={meta['valid']:.3f} range={meta['min']}..{meta['max']}"


def main() -> None:
    os.makedirs(RAW, exist_ok=True)
    names = sorted(name for name in os.listdir(LIDAR) if name.endswith(".tif"))
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for line in pool.map(convert, names):
            print(line, flush=True)
    print("raw done")


if __name__ == "__main__":
    main()
