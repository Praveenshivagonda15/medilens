

let wasmInstance = null;

export async function initWasm() {
  if (wasmInstance) return wasmInstance;
  try {

    const response = await fetch('/image_processor.wasm');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: (msg, file, line, col) => {
          console.error(`Wasm aborted at ${file}:${line}:${col} - msg: ${msg}`);
        }
      }
    });
    wasmInstance = instance;
    return wasmInstance;
  } catch (err) {
    console.error("Failed to initialize WebAssembly image processor:", err);
    return null;
  }
}

export async function processImageWasm(imageSource, filterType = 1) {
  const instance = await initWasm();
  if (!instance) {
    throw new Error("WebAssembly module is not initialized.");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
    
    img.onload = () => {
      try {
        if (typeof imageSource !== 'string') {
          URL.revokeObjectURL(objectUrl);
        }

        let { width, height } = img;
        const MAX_DIM = 1000;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height / width) * MAX_DIM);
            width = MAX_DIM;
          } else {
            width = Math.round((width / height) * MAX_DIM);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const exports = instance.exports;
        const bufferPtr = exports.getBufferPtr();
        const bufferSize = exports.getBufferSize();

        if (data.length > bufferSize) {
          reject(new Error("Image size exceeds WebAssembly memory limit."));
          return;
        }

        const wasmMemory = new Uint8Array(exports.memory.buffer);
        wasmMemory.set(data, bufferPtr);

        exports.processImage(width, height, filterType);

        const packedCoords = exports.detectBoundingBox(width, height);
        let cropCoords = null;
        if (packedCoords !== 0n) {

          const minY = Number((packedCoords >> 48n) & 0xFFFFn);
          const minX = Number((packedCoords >> 32n) & 0xFFFFn);
          const maxY = Number((packedCoords >> 16n) & 0xFFFFn);
          const maxX = Number(packedCoords & 0xFFFFn);
          
          cropCoords = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
        }

        const processedMemory = new Uint8Array(exports.memory.buffer);
        const outputBuffer = processedMemory.subarray(bufferPtr, bufferPtr + data.length);
        const outputImgData = new ImageData(new Uint8ClampedArray(outputBuffer), width, height);

        let finalCanvas = canvas;
        if (cropCoords && cropCoords.w > 50 && cropCoords.h > 50) {
          finalCanvas = document.createElement('canvas');
          finalCanvas.width = cropCoords.w;
          finalCanvas.height = cropCoords.h;
          const cropCtx = finalCanvas.getContext('2d');

          ctx.putImageData(outputImgData, 0, 0);
          cropCtx.drawImage(canvas, cropCoords.minX, cropCoords.minY, cropCoords.w, cropCoords.h, 0, 0, cropCoords.w, cropCoords.h);
        } else {
          ctx.putImageData(outputImgData, 0, 0);
        }

        const base64 = finalCanvas.toDataURL('image/jpeg', 0.50).split(',')[1];
        
        resolve({
          base64,
          width: finalCanvas.width,
          height: finalCanvas.height,
          cropCoords
        });
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      if (typeof imageSource !== 'string') {
        URL.revokeObjectURL(objectUrl);
      }
      reject(new Error("Failed to load image element for Wasm processing."));
    };

    img.src = objectUrl;
  });
}
