// src/wasm/image_processor.ts
// AssemblyScript source for high-performance vision preprocessing

const MAX_WIDTH: i32 = 2048;
const MAX_HEIGHT: i32 = 2048;
const BUFFER_SIZE: i32 = MAX_WIDTH * MAX_HEIGHT * 4;

// Allocate the image buffer in WebAssembly linear memory
export const imgBuffer = new Uint8Array(BUFFER_SIZE);

// Helper to get buffer pointer
export function getBufferPtr(): usize {
  return imgBuffer.dataStart;
}

// Helper to get buffer size
export function getBufferSize(): i32 {
  return BUFFER_SIZE;
}

// Convert RGBA to grayscale and perform image filters
// filterType:
//   1 = Adaptive Thresholding (Otsu/Local Mean binarization)
//   2 = Sobel Edge Detection
//   3 = Contrast stretching + global threshold
export function processImage(width: i32, height: i32, filterType: i32): void {
  const size = width * height;
  if (size > MAX_WIDTH * MAX_HEIGHT) return;

  // Temporary buffer for grayscale values
  const gray = new Uint8Array(size);

  // 1. Convert to grayscale in-place
  for (let i = 0; i < size; i++) {
    const r = f32(imgBuffer[i * 4]);
    const g = f32(imgBuffer[i * 4 + 1]);
    const b = f32(imgBuffer[i * 4 + 2]);
    // Standard luminance weights: 0.299R + 0.587G + 0.114B
    gray[i] = u8(0.299 * r + 0.587 * g + 0.114 * b);
  }

  if (filterType == 1) {
    // --- ADAPTIVE THRESHOLDING (Integral Image method) ---
    // Window size S = width / 8, constant C = 10
    const s = width / 8;
    const c = 10;

    // Create integral image
    const integral = new Uint32Array(size);
    for (let y = 0; y < height; y++) {
      let sum: u32 = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        sum += u32(gray[idx]);
        if (y == 0) {
          integral[idx] = sum;
        } else {
          integral[idx] = integral[(y - 1) * width + x] + sum;
        }
      }
    }

    // Apply local thresholding
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        
        const x1 = Math.max(x - s, 0) as i32;
        const x2 = Math.min(x + s, width - 1) as i32;
        const y1 = Math.max(y - s, 0) as i32;
        const y2 = Math.min(y + s, height - 1) as i32;

        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        
        const br = integral[y2 * width + x2];
        const tr = y1 > 0 ? integral[(y1 - 1) * width + x2] : 0;
        const bl = x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0;
        const tl = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * width + (x1 - 1)] : 0;

        const sum = br - tr - bl + tl;
        const mean = sum / count;
        
        const val: u8 = (gray[idx] as u32) < (mean - c) ? 0 : 255;
        
        imgBuffer[idx * 4] = val;
        imgBuffer[idx * 4 + 1] = val;
        imgBuffer[idx * 4 + 2] = val;
        imgBuffer[idx * 4 + 3] = 255; // Keep alpha channel 255
      }
    }
  } else if (filterType == 2) {
    // --- SOBEL EDGE DETECTION ---
    const edges = new Uint8Array(size);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const v00 = f32(gray[(y - 1) * width + (x - 1)]);
        const v01 = f32(gray[(y - 1) * width + x]);
        const v02 = f32(gray[(y - 1) * width + (x + 1)]);
        
        const v10 = f32(gray[y * width + (x - 1)]);
        const v12 = f32(gray[y * width + (x + 1)]);
        
        const v20 = f32(gray[(y + 1) * width + (x - 1)]);
        const v21 = f32(gray[(y + 1) * width + x]);
        const v22 = f32(gray[(y + 1) * width + (x + 1)]);

        const gx = (v02 + 2 * v12 + v22) - (v00 + 2 * v10 + v20);
        const gy = (v20 + 2 * v21 + v22) - (v00 + 2 * v01 + v02);
        
        const mag = Math.sqrt(gx * gx + gy * gy) as i32;
        edges[y * width + x] = Math.min(mag, 255) as u8;
      }
    }

    // Write edges back to buffer
    for (let i = 0; i < size; i++) {
      const val = edges[i];
      imgBuffer[i * 4] = val;
      imgBuffer[i * 4 + 1] = val;
      imgBuffer[i * 4 + 2] = val;
      imgBuffer[i * 4 + 3] = 255;
    }
  } else if (filterType == 3) {
    // --- CONTRAST STRETCH & OTSU THRESHOLD ---
    let minVal: u8 = 255;
    let maxVal: u8 = 0;
    
    for (let i = 0; i < size; i++) {
      const v = gray[i];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }

    const range = (maxVal - minVal) as f32;
    const factor = range > 0.0 ? 255.0 / range : 1.0;

    // Apply contrast stretching and global threshold (Otsu-like middle threshold)
    const threshold: u8 = (minVal + (maxVal - minVal) / 2) as u8;

    for (let i = 0; i < size; i++) {
      // Stretch contrast
      const stretched = u8((f32(gray[i] - minVal)) * factor);
      const val: u8 = stretched < threshold ? 0 : 255;

      imgBuffer[i * 4] = val;
      imgBuffer[i * 4 + 1] = val;
      imgBuffer[i * 4 + 2] = val;
      imgBuffer[i * 4 + 3] = 255;
    }
  }
}

// Find medicine strip bounding box (cropping coordinates)
// Returns [minX, minY, maxX, maxY] packed into a 64-bit integer
// format: (minY << 48) | (minX << 32) | (maxY << 16) | maxX
export function detectBoundingBox(width: i32, height: i32): u64 {
  // Apply edge detection on a scaled grid to find the boundary of the medicine strip
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  // Analyze pixels in a grid
  for (let y = 10; y < height - 10; y += 4) {
    for (let x = 10; x < width - 10; x += 4) {
      const idx = y * width + x;
      // If we see black/text or high edge energy
      const r = imgBuffer[idx * 4];
      const g = imgBuffer[idx * 4 + 1];
      const b = imgBuffer[idx * 4 + 2];
      
      // Grayscale value
      const val = u8(0.299 * f32(r) + 0.587 * f32(g) + 0.114 * f32(b));
      
      // If pixel is sufficiently dark (text/shadows) or stands out
      if (val < 90) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Padding
  minX = Math.max(minX - 10, 0) as i32;
  minY = Math.max(minY - 10, 0) as i32;
  maxX = Math.min(maxX + 10, width - 10) as i32;
  maxY = Math.min(maxY + 10, height - 10) as i32;

  if (maxX <= minX || maxY <= minY) {
    return 0; // failed to detect
  }

  const pMinY = u64(minY) << 48;
  const pMinX = u64(minX) << 32;
  const pMaxY = u64(maxY) << 16;
  const pMaxX = u64(maxX);

  return pMinY | pMinX | pMaxY | pMaxX;
}

// Compute image focus metric using variance of Sobel gradients
export function computeFocusMetric(width: i32, height: i32): f32 {
  const size = width * height;
  if (size > MAX_WIDTH * MAX_HEIGHT) return 0.0;

  // Convert to grayscale
  const gray = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const r = f32(imgBuffer[i * 4]);
    const g = f32(imgBuffer[i * 4 + 1]);
    const b = f32(imgBuffer[i * 4 + 2]);
    gray[i] = u8(0.299 * r + 0.587 * g + 0.114 * b);
  }

  let sum: f32 = 0.0;
  let count: f32 = 0.0;
  const magnitudes = new Float32Array(size);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const v00 = f32(gray[(y - 1) * width + (x - 1)]);
      const v01 = f32(gray[(y - 1) * width + x]);
      const v02 = f32(gray[(y - 1) * width + (x + 1)]);
      
      const v10 = f32(gray[y * width + (x - 1)]);
      const v12 = f32(gray[y * width + (x + 1)]);
      
      const v20 = f32(gray[(y + 1) * width + (x - 1)]);
      const v21 = f32(gray[(y + 1) * width + x]);
      const v22 = f32(gray[(y + 1) * width + (x + 1)]);

      const gx = (v02 + 2.0 * v12 + v22) - (v00 + 2.0 * v10 + v20);
      const gy = (v20 + 2.0 * v21 + v22) - (v00 + 2.0 * v01 + v02);

      const mag = Math.sqrt(gx * gx + gy * gy) as f32;
      magnitudes[idx] = mag;
      sum += mag;
      count += 1.0;
    }
  }

  const mean = sum / count;
  let varianceSum: f32 = 0.0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const diff = magnitudes[idx] - mean;
      varianceSum += diff * diff;
    }
  }

  return varianceSum / count;
}
