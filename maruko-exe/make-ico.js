/* Build a Windows ICO containing PNG-compressed sizes from icon-source.png. */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "assets");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map((size) => {
  const file = path.join(dir, `icon-${size}.png`);
  if (!fs.existsSync(file)) throw new Error(`missing resized icon: ${file}`);
  return { size, data: fs.readFileSync(file) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // icon type
header.writeUInt16LE(entries.length, 4);
const table = Buffer.alloc(entries.length * 16);
let offset = header.length + table.length;
for (let i = 0; i < entries.length; i += 1) {
  const { size, data } = entries[i];
  const p = i * 16;
  table.writeUInt8(size === 256 ? 0 : size, p);
  table.writeUInt8(size === 256 ? 0 : size, p + 1);
  table.writeUInt8(0, p + 2);       // color count
  table.writeUInt8(0, p + 3);       // reserved
  table.writeUInt16LE(1, p + 4);    // planes
  table.writeUInt16LE(32, p + 6);   // bits per pixel
  table.writeUInt32LE(data.length, p + 8);
  table.writeUInt32LE(offset, p + 12);
  offset += data.length;
}
fs.writeFileSync(path.join(dir, "app.ico"), Buffer.concat([header, table, ...entries.map((e) => e.data)]));
console.log(`wrote app.ico (${entries.length} sizes)`);
