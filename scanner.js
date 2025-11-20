(() => {
  // Namespace to avoid pollution
  const ShadowInspector = {
    MAX_DEPTH: 32, // Increased from 16 based on user feedback
    CHUNK_TIME_MS: 10,
    nodeMap: new Map(),
    domToId: new WeakMap(), // Reverse lookup for Inspect Mode
    overlayEl: null,
  };

  // --- React Fiber Helpers ---
  const getReactFiber = (node) => {
    const key = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
    return key ? node[key] : null;
  };

  const getComponentName = (fiber) => {
    if (!fiber) return null;
    const type = fiber.type;
    if (typeof type === 'string') return type; // HTML tag
    if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
    if (typeof type === 'object' && type !== null) {
      if (type.$$typeof && type.$$typeof.toString() === 'Symbol(react.provider)') return 'Context.Provider';
      if (type.$$typeof && type.$$typeof.toString() === 'Symbol(react.context)') return 'Context.Consumer';
      if (type.$$typeof && type.$$typeof.toString() === 'Symbol(react.forward_ref)') return 'ForwardRef';
      if (type.$$typeof && type.$$typeof.toString() === 'Symbol(react.memo)') return 'Memo';
    }
    return 'Unknown';
  };

  const safeDeepClone = (obj, seen = new WeakSet(), depth = 0) => {
    const MAX_PROPS_DEPTH = 5; // Prevent deep trees in props
    if (depth > MAX_PROPS_DEPTH) return '...';

    if (obj === null || typeof obj !== 'object') {
      if (typeof obj === 'function') {
        return 'ƒ ' + (obj.name || '()');
      }
      if (typeof obj === 'symbol') {
        return obj.toString();
      }
      return obj;
    }

    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    // Handle Arrays
    if (Array.isArray(obj)) {
      return obj.map(item => safeDeepClone(item, seen, depth + 1));
    }

    // Handle Maps
    if (obj instanceof Map) {
      const mapObj = {};
      mapObj.__kind = 'Map';
      mapObj.entries = {};
      try {
        for (const [key, value] of obj) {
          const keyStr = String(key);
          mapObj.entries[keyStr] = safeDeepClone(value, seen, depth + 1);
        }
      } catch (e) { return '[Map Error]'; }
      return mapObj;
    }

    // Handle Sets
    if (obj instanceof Set) {
      const setArr = [];
      try {
        for (const value of obj) {
          setArr.push(safeDeepClone(value, seen, depth + 1));
        }
      } catch (e) { return '[Set Error]'; }
      return { __kind: 'Set', values: setArr };
    }

    // Handle React Elements
    if (obj.$$typeof && obj.$$typeof.toString() === 'Symbol(react.element)') {
       const name = getComponentName({ type: obj.type }) || 'Unknown';
       return {
         __kind: 'ReactElement',
         name: name,
         key: obj.key,
         props: safeDeepClone(obj.props, seen, depth + 1)
       };
    }

    // Handle plain objects
    const newObj = {};
    try {
      for (const key in obj) {
        // Skip internal React keys or massive objects if necessary
        if (key.startsWith('_')) continue; 
        
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = safeDeepClone(obj[key], seen, depth + 1);
        }
      }
    } catch (e) {
      return '[Unserializable Object]';
    }
    return newObj;
  };

  const getReactInfo = (node) => {
    try {
      let fiber = getReactFiber(node);
      if (!fiber) return null;

      let componentName = null;
      let props = {};
      let hooks = [];
      
      // Safety: Prevent infinite loops during fiber traversal
      let curr = fiber;
      let depth = 0;
      const MAX_FIBER_DEPTH = 100;

      while (curr && depth < MAX_FIBER_DEPTH) {
        if (typeof curr.type === 'function' || (typeof curr.type === 'object' && curr.type !== null)) {
          componentName = getComponentName(curr);
          break;
        }
        curr = curr.return;
        depth++;
      }

      const targetFiber = curr || fiber;
      
      if (targetFiber.memoizedProps) {
        try {
          const rawProps = targetFiber.memoizedProps;
          for (const key in rawProps) {
            if (key === 'children') continue;
            // Limit prop processing time if needed, but safeDeepClone has depth limit
            props[key] = safeDeepClone(rawProps[key]);
          }
        } catch (e) {
          console.warn("[Scanner] Error cloning props:", e);
          props = { error: 'Failed to serialize props' };
        }
      }

      if (targetFiber.memoizedState) {
        let hook = targetFiber.memoizedState;
        let hookCount = 0;
        const MAX_HOOKS = 50; // Safety limit

        while (hook && hookCount < MAX_HOOKS) {
          try {
            hooks.push({
              value: safeDeepClone(hook.memoizedState),
            });
          } catch (e) {
            hooks.push({ value: '[Unserializable Hook]' });
          }
          hook = hook.next;
          hookCount++;
        }
        if (hook) {
           hooks.push({ value: '...more hooks truncated' });
        }
      }

      return {
        componentName: componentName || node.tagName.toLowerCase(),
        props,
        hooks
      };
    } catch (err) {
      console.error("[Scanner] Critical error in getReactInfo:", err);
      return { error: "Failed to inspect component" };
    }
  };

  // --- Scanner Logic ---
  const shouldScan = (node) => {
    return node.nodeType === Node.ELEMENT_NODE;
  };

  const scanShadowRoots = async (root = document.body) => {
    console.log("[Scanner] Starting scan...");
    const result = {
      root: null,
      stats: { scanned: 0, shadowRoots: 0 }
    };

    const visited = new WeakSet();
    ShadowInspector.nodeMap.clear(); // Clear map on new scan
    
    const serialize = (node, depth = 0, path = 'root') => {
      if (!node) return null;
      
      // Lightweight React Info (Component Name only)
      let componentName = null;
      try {
        const fiber = getReactFiber(node);
        if (fiber) {
           // We just need the name for the tree
          let curr = fiber;
          while (curr) {
            if (typeof curr.type === 'function' || (typeof curr.type === 'object' && curr.type !== null)) {
                componentName = getComponentName(curr);
                break;
            }
            curr = curr.return;
          }
        }
      } catch (e) {
        // ignore
      }
      
      const info = {
        _id: path,
        tag: componentName || (node.tagName ? node.tagName.toLowerCase() : 'text'),
        originalTag: node.tagName ? node.tagName.toLowerCase() : 'text',
        id: node.id || null,
        classes: node.classList ? [...node.classList] : [],
        // attributes: node.attributes ? [...node.attributes].map(a => ({ name: a.name, value: a.value })) : [], // Keep attributes for now, usually small
        hasChildren: (node.childNodes && node.childNodes.length > 0) || (!!node.shadowRoot), // Hint for UI
        children: [],
        shadow: null
      };
      
      ShadowInspector.nodeMap.set(path, node);
      ShadowInspector.domToId.set(node, path);

      if (depth > ShadowInspector.MAX_DEPTH) {
        info.children = [{ tag: '...max depth reached...', _id: path + '.max' }];
        return info;
      }

      return info;
    };

    const rootInfo = serialize(root, 0, 'root');
    result.root = rootInfo;

    const queue = [{ domNode: root, infoNode: rootInfo, depth: 0 }];
    
    let startTime = performance.now();

    while (queue.length > 0) {
      if (performance.now() - startTime > ShadowInspector.CHUNK_TIME_MS) {
        await new Promise(resolve => requestIdleCallback(resolve));
        startTime = performance.now();
      }

      const { domNode, infoNode, depth } = queue.shift();

      if (visited.has(domNode)) continue;
      visited.add(domNode);
      result.stats.scanned++;

      if (domNode.shadowRoot) {
        result.stats.shadowRoots++;
        const shadowInfo = {
          _id: infoNode._id + '.shadow',
          tag: '#shadow-root',
          mode: domNode.shadowRoot.mode,
          children: []
        };
        infoNode.shadow = shadowInfo;
        ShadowInspector.nodeMap.set(shadowInfo._id, domNode.shadowRoot); // Fix: Map the shadow root!
        
        let childIndex = 0;
        for (const child of domNode.shadowRoot.childNodes) {
          if (shouldScan(child)) {
            const childPath = shadowInfo._id + '.' + childIndex;
            const childInfo = serialize(child, depth + 1, childPath);
            shadowInfo.children.push(childInfo);
            queue.push({ domNode: child, infoNode: childInfo, depth: depth + 1 });
            childIndex++;
          }
        }
      }

      if (domNode.childNodes && domNode.childNodes.length > 0) {
        let childIndex = 0;
        for (const child of domNode.childNodes) {
          if (shouldScan(child)) {
            const childPath = infoNode._id + '.' + childIndex;
            const childInfo = serialize(child, depth + 1, childPath);
            infoNode.children.push(childInfo);
            queue.push({ domNode: child, infoNode: childInfo, depth: depth + 1 });
            childIndex++;
          }
        }
      }
    }

    return result;
  };

  // --- Highlight Logic ---
  const updateOverlay = (rect) => {
    if (!ShadowInspector.overlayEl) {
      ShadowInspector.overlayEl = document.createElement('div');
      ShadowInspector.overlayEl.style.position = 'fixed';
      ShadowInspector.overlayEl.style.zIndex = '100000';
      ShadowInspector.overlayEl.style.pointerEvents = 'none';
      ShadowInspector.overlayEl.style.background = 'rgba(111, 168, 220, 0.66)';
      ShadowInspector.overlayEl.style.border = '1px solid #6fa8dc';
      ShadowInspector.overlayEl.style.transition = 'all 0.1s ease';
      document.body.appendChild(ShadowInspector.overlayEl);
    }
    
    if (!rect) {
      ShadowInspector.overlayEl.style.display = 'none';
      return;
    }
    
    ShadowInspector.overlayEl.style.display = 'block';
    ShadowInspector.overlayEl.style.top = rect.top + 'px';
    ShadowInspector.overlayEl.style.left = rect.left + 'px';
    ShadowInspector.overlayEl.style.width = rect.width + 'px';
    ShadowInspector.overlayEl.style.height = rect.height + 'px';
  };

  // --- State ---
  let currentScanTimeout = null;

  // --- Inspect Mode ---
  let inspectModeEnabled = false;
  let highlightOverlay = null; // For inspect mode highlighting
  let suppressAutoScan = false;

  function enableInspectMode() {
    if (inspectModeEnabled) return;
    inspectModeEnabled = true;
    document.addEventListener('mouseover', handleInspectHover, { capture: true, passive: true });
    document.addEventListener('click', handleInspectClick, { capture: true });
    document.body.style.cursor = 'crosshair';
    console.log('[Scanner] Inspect mode enabled');
  }

  function disableInspectMode() {
    if (!inspectModeEnabled) return;
    inspectModeEnabled = false;
    document.removeEventListener('mouseover', handleInspectHover, { capture: true });
    document.removeEventListener('click', handleInspectClick, { capture: true });
    if (highlightOverlay) {
      highlightOverlay.remove();
      highlightOverlay = null;
    }
    document.body.style.cursor = '';
    console.log('[Scanner] Inspect mode disabled');
  }

  function handleInspectHover(e) {
    if (!inspectModeEnabled) return;
    // Use composedPath to get the actual target inside Shadow DOM
    const path = e.composedPath();
    const target = path[0];

    if (target && target !== highlightOverlay) {
      highlightElement(target);
      
      // Find the ID for this element
      const id = ShadowInspector.domToId.get(target);
      if (id) {
        window.postMessage({
          source: 'shadow-inspect-scanner',
          action: 'element-hovered',
          id: id
        }, '*');
      }
    }
  }

  function handleInspectClick(e) {
    if (!inspectModeEnabled) return;
    e.preventDefault();
    e.stopPropagation();

    const path = e.composedPath();
    const target = path[0];

    if (target) {
      const id = ShadowInspector.domToId.get(target);
      if (id) {
        // Disable inspect mode IMMEDIATELY to prevent further events
        disableInspectMode();
        
        // Suppress auto-scan for a moment to prevent "initialization" if the app reacts to the click
        suppressAutoScan = true;
        setTimeout(() => { suppressAutoScan = false; }, 2000);

        window.postMessage({
          source: 'shadow-inspect-scanner',
          action: 'element-selected',
          id: id
        }, '*');
        
        // Notify panel to toggle button state (UI update)
        window.postMessage({ source: 'shadow-inspect-scanner', action: 'inspect-mode-disabled' }, '*');
      }
    }
  }

  function highlightElement(element) {
    if (!highlightOverlay) {
      highlightOverlay = document.createElement('div');
      highlightOverlay.style.position = 'fixed';
      highlightOverlay.style.pointerEvents = 'none';
      highlightOverlay.style.background = 'rgba(100, 180, 255, 0.3)';
      highlightOverlay.style.border = '2px solid #4a90e2';
      highlightOverlay.style.zIndex = '999999';
      highlightOverlay.style.transition = 'all 0.1s ease';
      document.body.appendChild(highlightOverlay);
    }

    const rect = element.getBoundingClientRect();
    highlightOverlay.style.top = rect.top + 'px';
    highlightOverlay.style.left = rect.left + 'px';
    highlightOverlay.style.width = rect.width + 'px';
    highlightOverlay.style.height = rect.height + 'px';
  }

  // --- Auto-Scan on DOM Mutation (SPA Support) ---
  let mutationTimeout;
  const mutationObserver = new MutationObserver((mutations) => {
    // Filter out mutations caused by our own highlight overlay
    const isRelevantMutation = mutations.some(mutation => {
      if (highlightOverlay && (mutation.target === highlightOverlay || highlightOverlay.contains(mutation.target))) {
        return false;
      }
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (highlightOverlay && (node === highlightOverlay || highlightOverlay.contains(node))) {
          return false;
        }
      }
      // Check removed nodes
      for (const node of mutation.removedNodes) {
        if (highlightOverlay && (node === highlightOverlay || highlightOverlay.contains(node))) {
          return false;
        }
      }
      return true;
    });

    if (!isRelevantMutation) return;

    // Debounce the scan to avoid performance issues during rapid updates
    if (mutationTimeout) clearTimeout(mutationTimeout);
    
    mutationTimeout = setTimeout(() => {
      if (suppressAutoScan) {
        console.log('[Scanner] Auto-scan suppressed due to recent selection.');
        return;
      }
      console.log('[Scanner] DOM mutation detected, triggering auto-scan...');
      window.postMessage({ source: 'shadow-inspect-scanner', action: 'content-updated' }, '*');
    }, 1000); // 1 second debounce
  });

  // Start observing the body for changes
  if (document.body) {
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false // We mainly care about structure changes
    });
  } else {
    // If body doesn't exist yet (e.g. run_at document_start), wait for it
    document.addEventListener('DOMContentLoaded', () => {
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });
    });
  }

  // --- Message Listener (Bridge) ---
  window.addEventListener('message', (event) => {
    // Only accept messages from the same window (content script)
    if (event.source !== window) return;
    
    const msg = event.data;
    if (!msg || !msg.source || msg.source !== 'shadow-inspect-content') return;

    if (msg.action === 'toggle-inspect-mode') {
      if (msg.enabled) {
        enableInspectMode();
      } else {
        disableInspectMode();
      }
    }

    if (msg.action === 'run-scan') {
      console.log(`[Scanner] Received scan request. Frame: ${window.location.href}`);
      
      // Cancel any existing polling to prevent zombie loops
      if (currentScanTimeout) {
        clearTimeout(currentScanTimeout);
        currentScanTimeout = null;
      }
      
      const MAX_RETRIES = 10;
      const RETRY_INTERVAL = 500; // ms
      let attempts = 0;

      const tryScan = async () => {
        attempts++;
        try {
          const result = await scanShadowRoots(document.body);
          
          // Heuristic: If we found 0 nodes, the app likely hasn't rendered yet.
          // We retry until we find something or hit max retries.
          const hasContent = result.stats.scanned > 0;
          
          if (hasContent || attempts >= MAX_RETRIES) {
            console.log(`[Scanner] Scan finished. Attempt: ${attempts}, Nodes: ${result.stats.scanned}, Shadows: ${result.stats.shadowRoots}`);
            window.postMessage({
              source: 'shadow-inspect-scanner',
              action: 'scan-result',
              result: result
            }, '*');
            currentScanTimeout = null; // Done
          } else {
            console.log(`[Scanner] No nodes found. Retrying... (${attempts}/${MAX_RETRIES})`);
            currentScanTimeout = setTimeout(tryScan, RETRY_INTERVAL);
          }
        } catch (e) {
          console.error("[Scanner] Scan error:", e);
          window.postMessage({
            source: 'shadow-inspect-scanner',
            action: 'scan-error',
            error: e.message
          }, '*');
          currentScanTimeout = null;
        }
      };
      
      tryScan();
    }
    
    if (msg.action === 'highlight') {
      const node = ShadowInspector.nodeMap.get(msg.id);
      if (node && node.getBoundingClientRect) {
        updateOverlay(node.getBoundingClientRect());
      } else {
        updateOverlay(null);
      }
    }

    if (msg.action === 'get-details') {
      const node = ShadowInspector.nodeMap.get(msg.id);
      if (node) {
        let details = {
          attributes: node.attributes ? [...node.attributes].map(a => ({ name: a.name, value: a.value })) : [],
          react: null
        };
        try {
          details.react = getReactInfo(node);
        } catch (e) {
          console.error("Error getting details", e);
        }
        
        window.postMessage({
          source: 'shadow-inspect-scanner',
          action: 'details-result',
          id: msg.id,
          details: details
        }, '*');
      } else {
        window.postMessage({
          source: 'shadow-inspect-scanner',
          action: 'details-error',
          id: msg.id,
          error: 'Node not found'
        }, '*');
      }
    }
  });

  console.log("[Scanner] Initialized in Main World");

})();
