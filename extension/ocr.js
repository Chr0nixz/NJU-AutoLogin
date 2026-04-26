/**
 * OCR Engine using onnxruntime-web
 * Ported from ddddocr preprocessing + ONNX inference
 * Runs inside offscreen document where WASM/ES modules work properly
 */

class OCREngine {
  constructor() {
    this.session = null;
    this.charset = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');
    ort.env.wasm.numThreads = 1;

    const charsetUrl = chrome.runtime.getURL('models/charset.json');
    const charsetResp = await fetch(charsetUrl);
    this.charset = await charsetResp.json();

    const modelUrl = chrome.runtime.getURL('models/common.onnx');
    this.session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled'
    });

    this.initialized = true;
  }

  preprocess(imageData, width, height) {
    const targetH = 64;
    const targetW = Math.round(width * (targetH / height));

    const float32Data = new Float32Array(targetH * targetW);
    for (let i = 0; i < targetH * targetW; i++) {
      float32Data[i] = imageData[i] / 255.0;
    }

    return new ort.Tensor('float32', float32Data, [1, 1, targetH, targetW]);
  }

  ctcDecode(predictedIndices) {
    const decoded = [];
    let prevIdx = null;
    for (const idx of predictedIndices) {
      if (idx !== prevIdx && idx !== 0) {
        decoded.push(idx);
      }
      prevIdx = idx;
    }
    return decoded;
  }

  async recognizeFromDataURL(dataURL) {
    if (!this.initialized) await this.init();

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataURL;
    });

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    // Convert to grayscale at original resolution
    const canvasOrig = document.createElement('canvas');
    canvasOrig.width = origW;
    canvasOrig.height = origH;
    const ctxOrig = canvasOrig.getContext('2d');
    ctxOrig.drawImage(img, 0, 0);
    const origData = ctxOrig.getImageData(0, 0, origW, origH);

    const grayOrig = new Uint8Array(origW * origH);
    for (let i = 0; i < origW * origH; i++) {
      const r = origData.data[i * 4];
      const g = origData.data[i * 4 + 1];
      const b = origData.data[i * 4 + 2];
      grayOrig[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    // Resize grayscale image to target size (keep aspect ratio)
    const targetH = 64;
    const targetW = Math.round(origW * (targetH / origH));

    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = origW;
    grayCanvas.height = origH;
    const grayCtx = grayCanvas.getContext('2d');
    const grayImgData = grayCtx.createImageData(origW, origH);
    for (let i = 0; i < origW * origH; i++) {
      grayImgData.data[i * 4] = grayOrig[i];
      grayImgData.data[i * 4 + 1] = grayOrig[i];
      grayImgData.data[i * 4 + 2] = grayOrig[i];
      grayImgData.data[i * 4 + 3] = 255;
    }
    grayCtx.putImageData(grayImgData, 0, 0);

    const resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = targetW;
    resizeCanvas.height = targetH;
    const resizeCtx = resizeCanvas.getContext('2d');
    resizeCtx.imageSmoothingEnabled = true;
    resizeCtx.imageSmoothingQuality = 'high';
    resizeCtx.drawImage(grayCanvas, 0, 0, targetW, targetH);
    const resizedData = resizeCtx.getImageData(0, 0, targetW, targetH);

    const gray = new Uint8Array(targetH * targetW);
    for (let i = 0; i < targetH * targetW; i++) {
      gray[i] = resizedData.data[i * 4];
    }

    const inputTensor = this.preprocess(gray, targetW, targetH);

    const inputName = this.session.inputNames[0];
    const feeds = { [inputName]: inputTensor };
    const output = await this.session.run(feeds);
    const outputName = this.session.outputNames[0];
    const outputData = output[outputName].data;
    const dims = output[outputName].dims;

    let seqlen, numClasses, batchSize;
    if (dims.length === 3) {
      if (dims[1] === 1) { seqlen = dims[0]; batchSize = 1; numClasses = dims[2]; }
      else if (dims[0] === 1) { seqlen = dims[1]; batchSize = 1; numClasses = dims[2]; }
      else throw new Error('Cannot determine batch dim: ' + JSON.stringify(dims));
    } else if (dims.length === 2) {
      seqlen = dims[0]; numClasses = dims[1]; batchSize = 1;
    } else {
      throw new Error('Unexpected output shape: ' + JSON.stringify(dims));
    }

    const predicted = [];
    for (let t = 0; t < seqlen; t++) {
      let maxIdx = 0, maxVal = -Infinity;
      for (let c = 0; c < numClasses; c++) {
        const val = outputData[t * batchSize * numClasses + c];
        if (val > maxVal) { maxVal = val; maxIdx = c; }
      }
      predicted.push(maxIdx);
    }

    const decodedIndices = this.ctcDecode(predicted);
    return decodedIndices
      .map(idx => (idx >= 0 && idx < this.charset.length) ? this.charset[idx] : '')
      .join('');
  }
}
