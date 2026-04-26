/**
 * Offscreen document: runs ONNX inference in a proper document context
 * where onnxruntime-web can load WASM and ES modules.
 */

const ocrEngine = new OCREngine();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'recognize') {
    ocrEngine.recognizeFromDataURL(msg.imageDataURL)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }
});
