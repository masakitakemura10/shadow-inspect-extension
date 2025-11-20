chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ensure we have a tabId.
  // If the message comes from devtools panel, msg.tabId should be set.
  // If it comes from content script, sender.tab.id should be used.
  const tabId = msg.tabId || (sender.tab ? sender.tab.id : null);

  if (!tabId) {
    // Some messages might not need a tabId (e.g. internal), but for these actions we do.
    // If we can't determine tabId, we can't proceed for these actions.
    return; 
  }

  if (msg.action === "scan-shadow") {
    // We want to scan ALL frames and find the one with actual content.
    // Since chrome.tabs.sendMessage only targets one frame (default top),
    // we need to manually target all frames if we want to be robust.
    // However, we don't have webNavigation permission.
    
    // Alternative: Send to top frame, and if it has 0 nodes, maybe it's a shell?
    // But the user's case is likely an iframe.
    
    // Let's try to use the 'options' parameter of sendMessage if available? No.
    
    // We will use a heuristic:
    // 1. Try to send to the top frame first.
    // 2. If the result is empty (or nearly empty), we might want to look elsewhere.
    // BUT, we can't easily "list frames" without permissions.
    
    // WAIT: We can use chrome.webNavigation if we add it to permissions, 
    // OR we can just broadcast?
    // Actually, content scripts are running in all frames now.
    // If we use chrome.tabs.sendMessage(tabId, ...), it goes to the top frame.
    
    // To reach iframes, we need their frameIds.
    // Without 'webNavigation', we can't list them.
    
    // Let's add 'webNavigation' to permissions? No, that's heavy.
    
    // Better idea:
    // When content scripts load, they can "register" themselves with the background script?
    // Or, we can just assume the user might be inspecting a frame.
    
    // Let's try to simply enable "all_frames" in the sendMessage call?
    // chrome.tabs.sendMessage(tabId, message, options, callback)
    // options: { frameId: number }
    // It doesn't support "all frames".
    
    // WORKAROUND:
    // We will inject a script that finds all frames? No.
    
    // Let's use the fact that we enabled `all_frames: true` in manifest.
    // We can have the content scripts listen to a broadcast?
    // But `chrome.tabs.sendMessage` is point-to-point.
    
    // Let's try this:
    // 1. We add `webNavigation` permission to manifest (it's internal tool, so fine).
    // 2. We list all frames.
    // 3. We send scan to all frames.
    // 4. We pick the result with the most nodes.
    
    // Wait, `webNavigation` is not in the current manifest.
    // Let's add it.
    
    // Placeholder for now: just try to send to frame 0 (top).
    // If the user says "Nothing displayed", it means frame 0 is empty.
    
    // Let's implement the "Scan All Frames" logic assuming we add the permission.
    
    chrome.webNavigation.getAllFrames({ tabId: msg.tabId }, (frames) => {
      if (!frames || frames.length === 0) {
        console.log("[Background] No frames found or permission error. Fallback to top frame.");
        chrome.tabs.sendMessage(msg.tabId, { action: "run-scan" }, sendResponse);
        return;
      }

      console.log(`[Background] Scanning ${frames.length} frames...`);
      let pending = frames.length;
      let bestResult = { root: null, stats: { scanned: 0, shadowRoots: 0 } };
      
      frames.forEach(frame => {
        chrome.tabs.sendMessage(msg.tabId, { action: "run-scan" }, { frameId: frame.frameId }, (response) => {
          pending--;
          
          if (chrome.runtime.lastError) {
            console.warn(`[Background] Error scanning frame ${frame.frameId}:`, chrome.runtime.lastError.message);
          } else if (response && response.stats) {
            console.log(`[Background] Frame ${frame.frameId} result:`, response.stats);
            if (response.stats.scanned > bestResult.stats.scanned) {
              bestResult = response;
            }
          }
          
          if (pending === 0) {
            console.log("[Background] Scan complete. Best result:", bestResult.stats);
            sendResponse(bestResult);
          }
        });
      });
    });
    
    return true; // Async response
  }
  
  if (msg.action === "highlight") {
    // Broadcast highlight to all frames
    chrome.webNavigation.getAllFrames({ tabId: msg.tabId }, (frames) => {
      if (!frames) return;
      frames.forEach(frame => {
        chrome.tabs.sendMessage(msg.tabId, { action: "highlight", id: msg.id }, { frameId: frame.frameId });
      });
    });
    sendResponse({ success: true });
    return false;
  }
  
  if (msg.action === "get-details") {
    // ... (keep existing logic)
    chrome.webNavigation.getAllFrames({ tabId: msg.tabId }, (frames) => {
      if (!frames) return;
      
      let pending = frames.length;
      let found = false;
      
      frames.forEach(frame => {
        chrome.tabs.sendMessage(msg.tabId, { action: "get-details", id: msg.id }, { frameId: frame.frameId }, (response) => {
          pending--;
          if (found) return; // Already found
          
          if (response && !response.error && response.react !== undefined) {
            found = true;
            sendResponse(response);
          }
          
          if (pending === 0 && !found) {
            sendResponse({ error: "Node not found in any frame" });
          }
        });
      });
    });
    return true;
  }
  
  if (msg.action === "toggle-inspect-mode") {
    chrome.webNavigation.getAllFrames({ tabId: msg.tabId }, (frames) => {
      if (!frames) return;
      frames.forEach(frame => {
        chrome.tabs.sendMessage(msg.tabId, { action: "toggle-inspect-mode", enabled: msg.enabled }, { frameId: frame.frameId });
      });
    });
    sendResponse({ success: true });
    return false;
  }
  
  // Messages FROM content script TO panel
  if (msg.action === "element-hovered" || msg.action === "element-selected") {
    // Forward to the DevTools panel
    chrome.runtime.sendMessage(msg);
    // Do NOT return true here, as we don't intend to send a response back to content script.
    // This prevents "message channel closed" errors in content script.
    return; 
  }

  if (msg.action === "content-updated") {
    // Forward as navigation-detected to trigger a re-scan in the panel
    console.log('[Background] Content update detected, notifying panel');
    chrome.runtime.sendMessage({ 
      action: "navigation-detected",
      tabId: tabId 
    });
    return;
  }
});

// Listen for SPA navigation (History API)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) { // Only main frame navigation usually matters for SPA
    console.log("[Background] History state updated:", details.url);
    chrome.runtime.sendMessage({
      action: "navigation-detected",
      url: details.url,
      tabId: details.tabId
    });
  }
});