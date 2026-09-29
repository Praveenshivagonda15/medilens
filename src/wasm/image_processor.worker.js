

let wasmInstance = null;

self.onmessage = async function(e) {
  const { type } = e.data;
  
  if (type === 'init') {
    const { wasmBytes } = e.data;
    try {
      const { instance } = await WebAssembly.instantiate(wasmBytes, {
        env: {
          abort: (msg, file, line, col) => {
            console.error(`Wasm Worker aborted at ${file}:${line}:${col} - msg: ${msg}`);
          }
        }
      });
      wasmInstance = instance;
      self.postMessage({ type: 'initialized', success: true });
    } catch (err) {
      self.postMessage({ type: 'initialized', success: false, error: err.message });
    }
  } else if (type === 'process') {
    if (!wasmInstance) {
      self.postMessage({ type: 'error', error: 'Wasm not initialized in worker' });
      return;
    }
    
    const { filterType, width, height, data } = e.data;

    const exports = wasmInstance.exports;
    const bufferPtr = exports.getBufferPtr();
    const bufferSize = exports.getBufferSize();
    
    if (data.length > bufferSize) {
      self.postMessage({ type: 'error', error: 'Image size exceeds WebAssembly memory limit.' });
      return;
    }

    const wasmMemory = new Uint8Array(exports.memory.buffer);
    wasmMemory.set(data, bufferPtr);

    exports.processImage(width, height, filterType);

    let focusMetric = 0;
    if (exports.computeFocusMetric) {
      focusMetric = exports.computeFocusMetric(width, height);
    }

    const packedCoords = exports.detectBoundingBox(width, height);
    let cropCoords = null;
    if (packedCoords !== 0n) {
      const minY = Number((packedCoords >> 48n) & 0xFFFFn);
      const minX = Number((packedCoords >> 32n) & 0xFFFFn);
      const maxY = Number((packedCoords >> 16n) & 0xFFFFn);
      const maxX = Number(packedCoords & 0xFFFFn);
      
      cropCoords = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }

    const outputBuffer = new Uint8Array(exports.memory.buffer, bufferPtr, data.length);
    const outputCopy = new Uint8Array(outputBuffer);
    
    self.postMessage({
      type: 'processed',
      data: outputCopy,
      width,
      height,
      cropCoords,
      focusMetric
    }, [outputCopy.buffer]);
  }
};
