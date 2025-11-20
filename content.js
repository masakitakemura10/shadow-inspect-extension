/**
 * Content Script (Isolated World)
 * Acts as a bridge between DevTools/Background and the Main World Scanner.
 */

// Listen for messages from Background/DevTools
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "run-scan") {
    // Forward to Main World
    window.postMessage({
      source: 'shadow-inspect-content',
      action: 'run-scan'
    }, '*');
    
    // We need to wait for the response from window message
    // Since chrome.runtime.onMessage is async, we can't easily wait here without a custom listener
    // So we will send the response back via chrome.runtime.sendMessage when we get it.
    // OR, we can keep this channel open? No, better to use a one-off response if possible,
    // but window.postMessage is decoupled.
    
    // Let's use a temporary listener for the response
    const responseHandler = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data && data.source === 'shadow-inspect-scanner') {
        if (data.action === 'scan-result') {
          sendResponse(data.result);
          window.removeEventListener('message', responseHandler);
        } else if (data.action === 'scan-error') {
          sendResponse({ error: data.error });
          window.removeEventListener('message', responseHandler);
        }
      }
    };
    window.addEventListener('message', responseHandler);
    
    return true; // Keep channel open
  }
  
  if (msg.action === "toggle-inspect-mode") {
    window.postMessage({
      source: 'shadow-inspect-content',
      action: 'toggle-inspect-mode',
      enabled: msg.enabled
    }, '*');
    sendResponse({ success: true });
    return false; // No async response needed anymore
  }

  // ... (get-details handler remains)


  if (msg.action === "get-details") {
    window.postMessage({
      source: 'shadow-inspect-content',
      action: 'get-details',
      id: msg.id
    }, '*');
    
    const detailsHandler = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data && data.source === 'shadow-inspect-scanner') {
        if (data.action === 'details-result' && data.id === msg.id) {
          sendResponse(data.details);
          window.removeEventListener('message', detailsHandler);
        } else if (data.action === 'details-error' && data.id === msg.id) {
          sendResponse({ error: data.error });
          window.removeEventListener('message', detailsHandler);
        }
      }
    };
    window.addEventListener('message', detailsHandler);
    return true;
  }
  
  if (msg.action === "highlight") {
    // Forward to Main World
    window.postMessage({
      source: 'shadow-inspect-content',
      action: 'highlight',
      id: msg.id
    }, '*');
    sendResponse({ success: true });
  }
});

// Global listener for messages from Scanner (Main World)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  
  if (data && data.source === 'shadow-inspect-scanner') {
    // Handle "Push" events
    switch (data.action) {
      case 'element-hovered':
        chrome.runtime.sendMessage({ action: 'element-hovered', id: data.id });
        break;
      case 'element-selected':
        chrome.runtime.sendMessage({ action: 'element-selected', id: data.id });
        break;
      case 'inspect-mode-disabled':
        chrome.runtime.sendMessage({ action: 'inspect-mode-disabled' });
        break;
      case 'content-updated':
        chrome.runtime.sendMessage({ action: 'content-updated' });
        break;
    }
  }
});

console.log("[Content] Bridge initialized");