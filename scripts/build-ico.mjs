import fs from "node:fs";
import path from "node:path";

const files = [
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-64.png",
  "icons/icon-128.png",
  "icons/icon-256.png",
].map((file) => ({
  file,
  data: fs.readFileSync(file),
}));

function pngSize(buf) {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

const images = files.map((item) => ({
  ...item,
  ...pngSize(item.data),
}));

const headerSize = 6;
const dirSize = 16 * images.length;
let offset = headerSize + dirSize;
const dirs = [];

for (const image of images) {
  dirs.push({
    width: image.width >= 256 ? 0 : image.width,
    height: image.height >= 256 ? 0 : image.height,
    bytes: image.data.length,
    offset,
  });
  offset += image.data.length;
}

const out = Buffer.alloc(offset);
out.writeUInt16LE(0, 0); // reserved
out.writeUInt16LE(1, 2); // icon type
out.writeUInt16LE(images.length, 4);

dirs.forEach((dir, index) => {
  const base = headerSize + index * 16;
  out.writeUInt8(dir.width, base);
  out.writeUInt8(dir.height, base + 1);
  out.writeUInt8(0, base + 2);
  out.writeUInt8(0, base + 3);
  out.writeUInt16LE(1, base + 4);
  out.writeUInt16LE(32, base + 6);
  out.writeUInt32LE(dir.bytes, base + 8);
  out.writeUInt32LE(dir.offset, base + 12);
});

let cursor = headerSize + dirSize;
for (const image of images) {
  image.data.copy(out, cursor);
  cursor += image.data.length;
}

fs.writeFileSync(path.resolve("icons/icon.ico"), out);
console.log("wrote icons/icon.ico", out.length);
