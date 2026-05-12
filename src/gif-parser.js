// ============================================================
// Minimal GIF frame parser — extracts frames + per-frame delays
// Returns array of { imageData: ImageData, delay: number (ms) }
// Uses OffscreenCanvas for rendering each GIF frame.
// ============================================================

class GifParser {
  static async parse(url, scale = 1.0) {
    const resp = await fetch(url);
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const gif = GifParser._decode(bytes);
    const frames = [];
    const canvas = document.createElement("canvas");
    canvas.width = gif.width;
    canvas.height = gif.height;
    const ctx = canvas.getContext("2d");

    // Composite buffer for disposal methods
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = gif.width;
    compositeCanvas.height = gif.height;
    const compositeCtx = compositeCanvas.getContext("2d");
    compositeCtx.clearRect(0, 0, gif.width, gif.height);

    for (const frame of gif.frames) {
      // Handle disposal
      const prevComposite = compositeCtx.getImageData(0, 0, gif.width, gif.height);

      // Draw frame onto composite
      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = gif.width;
      frameCanvas.height = gif.height;
      const frameCtx = frameCanvas.getContext("2d");
      const imgData = frameCtx.createImageData(frame.width, frame.height);

      const ct = frame.colorTable || gif.globalColorTable;
      const transparentIndex = frame.transparentIndex;

      for (let i = 0; i < frame.pixels.length; i++) {
        const colorIndex = frame.pixels[i];
        if (colorIndex === transparentIndex) continue;
        const r = ct[colorIndex * 3];
        const g = ct[colorIndex * 3 + 1];
        const b = ct[colorIndex * 3 + 2];
        imgData.data[i * 4] = r;
        imgData.data[i * 4 + 1] = g;
        imgData.data[i * 4 + 2] = b;
        imgData.data[i * 4 + 3] = 255;
      }
      frameCtx.putImageData(imgData, 0, 0);
      compositeCtx.drawImage(frameCanvas, frame.left, frame.top);

      // Capture current state
      ctx.clearRect(0, 0, gif.width, gif.height);
      ctx.drawImage(compositeCanvas, 0, 0);

      // Scale if needed
      let finalCanvas;
      if (scale !== 1.0) {
        const sw = Math.round(gif.width * scale);
        const sh = Math.round(gif.height * scale);
        finalCanvas = document.createElement("canvas");
        finalCanvas.width = sw;
        finalCanvas.height = sh;
        const fctx = finalCanvas.getContext("2d");
        fctx.imageSmoothingEnabled = scale > 1.0;
        fctx.imageSmoothingQuality = "high";
        fctx.drawImage(canvas, 0, 0, sw, sh);
      } else {
        finalCanvas = document.createElement("canvas");
        finalCanvas.width = gif.width;
        finalCanvas.height = gif.height;
        finalCanvas.getContext("2d").drawImage(canvas, 0, 0);
      }

      frames.push({
        canvas: finalCanvas,
        delay: frame.delay || 80,
      });

      // Disposal method
      if (frame.disposalMethod === 2) {
        // Restore to background
        compositeCtx.clearRect(frame.left, frame.top, frame.width, frame.height);
      } else if (frame.disposalMethod === 3) {
        // Restore to previous
        compositeCtx.putImageData(prevComposite, 0, 0);
      }
      // 0, 1 = do not dispose
    }

    return {
      width: Math.round(gif.width * scale),
      height: Math.round(gif.height * scale),
      frames,
    };
  }

  // Create a horizontally flipped copy of parsed frames
  static flipFrames(parsedGif) {
    const flipped = [];
    for (const frame of parsedGif.frames) {
      const c = document.createElement("canvas");
      c.width = frame.canvas.width;
      c.height = frame.canvas.height;
      const ctx = c.getContext("2d");
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(frame.canvas, 0, 0);
      flipped.push({ canvas: c, delay: frame.delay });
    }
    return {
      width: parsedGif.width,
      height: parsedGif.height,
      frames: flipped,
    };
  }

  // ==================== GIF Binary Decoder ====================

  static _decode(bytes) {
    let pos = 0;
    const read = (n) => { const s = bytes.subarray(pos, pos + n); pos += n; return s; };
    const readU8 = () => bytes[pos++];
    const readU16 = () => { const v = bytes[pos] | (bytes[pos + 1] << 8); pos += 2; return v; };

    // Header
    const sig = String.fromCharCode(...read(6));
    if (!sig.startsWith("GIF")) throw new Error("Not a GIF");

    // Logical screen descriptor
    const width = readU16();
    const height = readU16();
    const packed = readU8();
    const bgIndex = readU8();
    readU8(); // pixel aspect ratio

    const gctFlag = (packed >> 7) & 1;
    const gctSize = 3 * (1 << ((packed & 7) + 1));

    let globalColorTable = null;
    if (gctFlag) {
      globalColorTable = read(gctSize);
    }

    const frames = [];
    let gce = null; // Graphics Control Extension

    while (pos < bytes.length) {
      const block = readU8();

      if (block === 0x21) {
        // Extension
        const label = readU8();
        if (label === 0xf9) {
          // Graphics Control Extension
          const size = readU8(); // always 4
          const gpacked = readU8();
          const delayCS = readU16(); // in centiseconds
          const transparentIdx = readU8();
          readU8(); // block terminator

          const disposalMethod = (gpacked >> 2) & 7;
          const hasTransparent = gpacked & 1;

          gce = {
            delay: delayCS * 10 || 80, // convert to ms, default 80
            transparentIndex: hasTransparent ? transparentIdx : -1,
            disposalMethod,
          };
        } else {
          // Skip other extensions
          while (true) {
            const sz = readU8();
            if (sz === 0) break;
            pos += sz;
          }
        }
      } else if (block === 0x2c) {
        // Image descriptor
        const left = readU16();
        const top = readU16();
        const fw = readU16();
        const fh = readU16();
        const fpacked = readU8();

        const lctFlag = (fpacked >> 7) & 1;
        const interlaced = (fpacked >> 6) & 1;
        const lctSize = 3 * (1 << ((fpacked & 7) + 1));

        let localColorTable = null;
        if (lctFlag) {
          localColorTable = read(lctSize);
        }

        // LZW decode
        const minCodeSize = readU8();
        const compressedData = [];
        while (true) {
          const sz = readU8();
          if (sz === 0) break;
          compressedData.push(...read(sz));
        }

        const pixels = GifParser._lzwDecode(minCodeSize, new Uint8Array(compressedData), fw * fh);

        // Deinterlace if needed
        let finalPixels = pixels;
        if (interlaced) {
          finalPixels = new Uint8Array(fw * fh);
          const passes = [
            { start: 0, step: 8 },
            { start: 4, step: 8 },
            { start: 2, step: 4 },
            { start: 1, step: 2 },
          ];
          let srcIdx = 0;
          for (const pass of passes) {
            for (let y = pass.start; y < fh; y += pass.step) {
              for (let x = 0; x < fw; x++) {
                finalPixels[y * fw + x] = pixels[srcIdx++];
              }
            }
          }
        }

        frames.push({
          left,
          top,
          width: fw,
          height: fh,
          pixels: finalPixels,
          colorTable: localColorTable,
          delay: gce ? gce.delay : 80,
          transparentIndex: gce ? gce.transparentIndex : -1,
          disposalMethod: gce ? gce.disposalMethod : 0,
        });

        gce = null;
      } else if (block === 0x3b) {
        // Trailer
        break;
      } else if (block === 0x00) {
        // Padding, skip
        continue;
      } else {
        // Unknown block, try to skip
        break;
      }
    }

    return { width, height, globalColorTable, frames };
  }

  static _lzwDecode(minCodeSize, data, pixelCount) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;
    let nextCode = eoiCode + 1;

    // Initialize code table
    const MAX_CODE = 4096;
    const prefix = new Int16Array(MAX_CODE);
    const suffix = new Uint8Array(MAX_CODE);
    const lengths = new Uint16Array(MAX_CODE);

    const initTable = () => {
      codeSize = minCodeSize + 1;
      codeMask = (1 << codeSize) - 1;
      nextCode = eoiCode + 1;
      for (let i = 0; i < clearCode; i++) {
        prefix[i] = -1;
        suffix[i] = i;
        lengths[i] = 1;
      }
    };

    initTable();

    const output = new Uint8Array(pixelCount);
    let outPos = 0;

    // Bit reader
    let bitBuf = 0;
    let bitCount = 0;
    let dataPos = 0;

    const readCode = () => {
      while (bitCount < codeSize) {
        if (dataPos >= data.length) return -1;
        bitBuf |= data[dataPos++] << bitCount;
        bitCount += 8;
      }
      const code = bitBuf & codeMask;
      bitBuf >>= codeSize;
      bitCount -= codeSize;
      return code;
    };

    // Stack for output
    const stack = new Uint8Array(MAX_CODE);

    let oldCode = -1;

    while (outPos < pixelCount) {
      const code = readCode();
      if (code === -1 || code === eoiCode) break;

      if (code === clearCode) {
        initTable();
        oldCode = -1;
        continue;
      }

      let outputCode = code;

      if (code >= nextCode) {
        // Special case: code not in table yet
        let stackPos = 0;
        let c = oldCode;
        // Push the first character of oldCode's string
        while (prefix[c] !== -1) c = prefix[c];
        stack[stackPos++] = suffix[c];
        outputCode = oldCode;
        // Fall through to output oldCode's string, then the extra char
        let sc = outputCode;
        while (prefix[sc] !== -1) {
          stack[stackPos++] = suffix[sc];
          sc = prefix[sc];
        }
        stack[stackPos++] = suffix[sc];
        // Write in reverse
        for (let i = stackPos - 1; i >= 0; i--) {
          if (outPos < pixelCount) output[outPos++] = stack[i];
        }
      } else {
        // Normal case: output code's string
        let stackPos = 0;
        let c = code;
        while (prefix[c] !== -1) {
          stack[stackPos++] = suffix[c];
          c = prefix[c];
        }
        stack[stackPos++] = suffix[c];
        for (let i = stackPos - 1; i >= 0; i--) {
          if (outPos < pixelCount) output[outPos++] = stack[i];
        }
      }

      // Add to code table
      if (oldCode !== -1 && nextCode < MAX_CODE) {
        prefix[nextCode] = oldCode;
        // First char of current code's string
        let c = code < nextCode ? code : oldCode;
        while (prefix[c] !== -1) c = prefix[c];
        suffix[nextCode] = suffix[c];
        lengths[nextCode] = lengths[oldCode] + 1;
        nextCode++;

        if (nextCode > codeMask && codeSize < 12) {
          codeSize++;
          codeMask = (1 << codeSize) - 1;
        }
      }

      oldCode = code;
    }

    return output;
  }
}
