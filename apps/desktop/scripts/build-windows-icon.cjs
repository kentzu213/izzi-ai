'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const desktopRoot = path.resolve(__dirname, '..');
const iconDir = path.join(desktopRoot, 'build', 'icons');
const outputPaths = [
  path.join(desktopRoot, 'build', 'icon.ico'),
  path.join(iconDir, 'icon.ico'),
];

function readPng(size) {
  const filePath = path.join(iconDir, `${size}x${size}.png`);
  const image = fs.readFileSync(filePath);
  if (image.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error(`Not a PNG file: ${filePath}`);
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== size || height !== size) {
    throw new Error(`Expected ${size}x${size}, got ${width}x${height}: ${filePath}`);
  }
  return image;
}

const images = SIZES.map(readPng);
const directorySize = 6 + images.length * 16;
const directory = Buffer.alloc(directorySize);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);

let imageOffset = directorySize;
images.forEach((image, index) => {
  const size = SIZES[index];
  const entryOffset = 6 + index * 16;
  directory[entryOffset] = size === 256 ? 0 : size;
  directory[entryOffset + 1] = size === 256 ? 0 : size;
  directory[entryOffset + 2] = 0;
  directory[entryOffset + 3] = 0;
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(image.length, entryOffset + 8);
  directory.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += image.length;
});

const ico = Buffer.concat([directory, ...images]);
for (const outputPath of outputPaths) {
  fs.writeFileSync(outputPath, ico);
}
console.log(`Wrote ${images.length}-frame Windows icon (${SIZES.join(', ')}px)`);