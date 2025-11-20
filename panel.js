// State Management
const state = {
  root: null,
  selectedId: null,
  expandedIds: new Set(['root']), // Expand root by default
  searchTerm: '',
  nodeMap: new Map() // Quick lookup for nodes by ID
};

// DOM Elements
const treeRoot = document.getElementById('tree-root');
const propsContent = document.getElementById('props-content');
const searchInput = document.getElementById('search-input');
const scanBtn = document.getElementById('scan-btn');
const inspectBtn = document.getElementById('inspect-btn');

// --- Initialization ---

scanBtn.onclick = performScan;

// Inspect Mode Toggle
let isInspectMode = false;
inspectBtn.onclick = () => {
  isInspectMode = !isInspectMode;
  toggleInspectMode(isInspectMode);
};

function toggleInspectMode(enabled) {
  if (enabled) {
    inspectBtn.classList.add('active');
  } else {
    inspectBtn.classList.remove('active');
  }
  
  chrome.runtime.sendMessage({ 
    action: "toggle-inspect-mode", 
    enabled: enabled,
    tabId: chrome.devtools.inspectedWindow.tabId 
  });
}

// Listen for inspect events from background -> panel
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'element-hovered') {
    // Highlight in tree? Maybe scroll to it?
    // For now, just expand to it?
    // Too noisy if we expand on hover.
    // Maybe just highlight if visible.
  }
  if (msg.action === 'element-selected') {
    selectNode(msg.id);
    // Expand to the node
    expandToNode(msg.id);
    // Turn off inspect mode
    isInspectMode = false;
    toggleInspectMode(false);
  }
  
  if (msg.action === 'navigation-detected') {
    // Check if it's for our tab
    if (msg.tabId === chrome.devtools.inspectedWindow.tabId) {
      console.log("[Panel] Navigation detected, re-scanning...");
      performScan();
    }
  }
});

function expandToNode(id) {
  // Walk up the ID path (e.g. root.0.1.shadow.2) and expand all parents
  const parts = id.split('.');
  let currentPath = parts[0];
  state.expandedIds.add(currentPath);
  
  for (let i = 1; i < parts.length - 1; i++) {
    currentPath += '.' + parts[i];
    state.expandedIds.add(currentPath);
  }
  renderTree();
  
  // Scroll to element
  setTimeout(() => {
    const el = treeRoot.querySelector(`.node-content.selected`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, 50);
}

/* Search Disabled
searchInput.oninput = (e) => {
  state.searchTerm = e.target.value.toLowerCase();
  renderTree();
};
*/

// Initial Scan
performScan();

// --- Core Logic ---

function performScan() {
  console.log('[Panel] performScan initiated');
  updateStatus('Scanning...', true);
  
  // Clear previous state
  const treeRoot = document.getElementById('tree-root');
  // Don't clear innerHTML immediately to avoid flashing if we can help it?
  // But we need to show loading status.
  // Let's keep the old tree visible but show a loading overlay?
  // For now, simple approach:
  if (treeRoot) treeRoot.innerHTML = '';
  
  state.nodeMap.clear();
  // Do NOT clear expandedIds so we preserve open folders
  // state.expandedIds.clear(); 
  // state.expandedIds.add('root'); // 'root' is always added anyway
  // state.selectedId = null; // Keep selectedId too, we try to restore it later

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.error('[Panel] Tab query error:', chrome.runtime.lastError);
      updateStatus('Error: ' + chrome.runtime.lastError.message);
      return;
    }
    
    if (!tabs[0] || !tabs[0].id) {
      console.error('[Panel] No active tab found');
      updateStatus('Error: No active tab found');
      return;
    }

    console.log('[Panel] Sending scan-shadow message to tab:', tabs[0].id);
    chrome.runtime.sendMessage({ 
      action: 'scan-shadow', 
      tabId: tabs[0].id 
    }, (response) => {
      console.log('[Panel] Received response from background:', response);
      
      if (chrome.runtime.lastError) {
        console.error('[Panel] Runtime error:', chrome.runtime.lastError);
        updateStatus('Connection error: ' + chrome.runtime.lastError.message + '. Try reloading the page.');
        return;
      }

      if (!response) {
        console.warn('[Panel] No response received');
        updateStatus('No response from scanner. Content script may not be ready.');
        return;
      }

      if (response.error) {
        console.error('[Panel] Scan error from background:', response.error);
        updateStatus('Scan Error: ' + response.error);
        return;
      }

      if (response.data || response.root) {
        // Handle both data formats (legacy 'data' or new 'root')
        const rootNode = response.root || response.data;
        console.log('[Panel] Scan data received. Root:', rootNode);
        try {
          state.root = rootNode;
          buildNodeMap(rootNode);
          renderTree();
          updateStatus(); // Clear status
          
          // Restore selection if possible
          if (state.selectedId && state.nodeMap.has(state.selectedId)) {
            selectNode(state.selectedId);
          }
        } catch (e) {
          console.error('[Panel] Error rendering tree:', e);
          updateStatus('Error rendering tree: ' + e.message);
        }
      } else {
        console.warn('[Panel] Response contained no data');
        updateStatus('No data found.');
      }
    });
  });
}

function updateStatus(msg) {
  console.log("[Panel] " + msg);
  // Always show status in the tree area for now to debug
  if (state.nodeMap.size === 0) {
    treeRoot.innerHTML = `<div style="padding:10px; color:#888;">${msg}</div>`;
  }
}

function buildNodeMap(node) {
  if (!node) return;
  state.nodeMap.set(node._id, node);
  
  if (node.children) {
    node.children.forEach(child => buildNodeMap(child));
  }
  if (node.shadow) {
    buildNodeMap(node.shadow);
    if (node.shadow.children) {
      node.shadow.children.forEach(child => buildNodeMap(child));
    }
  }
}

// --- Rendering ---

function renderTree() {
  console.log("[Panel] renderTree called", state.root);
  
  // Preserve scroll position
  const scrollPos = treeRoot.scrollTop;
  
  treeRoot.innerHTML = '';
  if (!state.root) {
    renderEmptyState("No data found. Click retry.");
    return;
  }
  
  try {
    const rootEl = createNodeElement(state.root);
    console.log("[Panel] Root element created", rootEl);
    treeRoot.appendChild(rootEl);
    
    // Restore scroll position
    // Use setTimeout to ensure layout is done? usually not needed for sync DOM append
    treeRoot.scrollTop = scrollPos;
    
  } catch (e) {
    console.error("[Panel] Error rendering tree:", e);
    treeRoot.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #888;">
        <div>Error rendering tree: ${e.message}</div>
        <button id="retry-btn" style="margin-top: 10px; padding: 6px 12px; cursor: pointer;">Retry</button>
      </div>
    `;
    document.getElementById('retry-btn').onclick = performScan;
  }
}

function renderEmptyState(msg) {
  treeRoot.innerHTML = `
    <div style="padding: 20px; text-align: center; color: #888;">
      <div>${msg}</div>
      <button id="retry-btn" style="margin-top: 10px; padding: 6px 12px; cursor: pointer;">Retry</button>
    </div>
  `;
  document.getElementById('retry-btn').onclick = performScan;
}

function createNodeElement(node) {
  const container = document.createElement('div');
  container.className = 'tree-node';
  
  // --- Content Row ---
  const content = document.createElement('div');
  content.className = 'node-content';
  if (node._id === state.selectedId) {
    content.classList.add('selected');
  }
  
  // Interaction: Selection
  content.onclick = (e) => {
    e.stopPropagation();
    selectNode(node._id);
  };
  
  // Interaction: Highlight with Delay
  let hoverTimeout;
  
  content.onmouseover = (e) => {
    e.stopPropagation();
    hoverTimeout = setTimeout(() => {
      chrome.runtime.sendMessage({ 
        action: "highlight", 
        id: node._id,
        tabId: chrome.devtools.inspectedWindow.tabId 
      });
    }, 300); // 300ms delay
  };
  
  content.onmouseout = (e) => {
    e.stopPropagation();
    if (hoverTimeout) clearTimeout(hoverTimeout);
    chrome.runtime.sendMessage({ 
      action: "highlight", 
      id: null,
      tabId: chrome.devtools.inspectedWindow.tabId 
    });
  };
  
  // Arrow
  const hasChildren = (node.children && node.children.length > 0) || node.shadow;
  const arrow = document.createElement('span');
  arrow.className = 'arrow';
  if (!hasChildren) {
    arrow.classList.add('invisible');
    arrow.textContent = '▶'; // Placeholder for spacing
  } else {
    arrow.textContent = '▶';
    if (state.expandedIds.has(node._id)) {
      arrow.classList.add('expanded');
    }
    
    // Interaction: Expansion
    arrow.onclick = (e) => {
      e.stopPropagation();
      toggleExpansion(node._id);
    };
  }
  content.appendChild(arrow);
  
  // Tag Name
  const tagSpan = document.createElement('span');
  tagSpan.className = 'tag-name';
  tagSpan.textContent = node.tag;
  content.appendChild(tagSpan);
  
  // Shadow Root Label
  if (node.tag === '#shadow-root') {
    const modeSpan = document.createElement('span');
    modeSpan.className = 'shadow-root-label';
    modeSpan.textContent = node.mode;
    content.appendChild(modeSpan);
  }
  
  // Attributes (Preview)
  if (node.attributes) {
    // Show id and class first
    const idAttr = node.attributes.find(a => a.name === 'id');
    const classAttr = node.attributes.find(a => a.name === 'class');
    
    if (idAttr) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'attr-name';
      nameSpan.textContent = '#';
      const valSpan = document.createElement('span');
      valSpan.className = 'attr-value';
      valSpan.textContent = idAttr.value;
      content.appendChild(nameSpan);
      content.appendChild(valSpan);
    }
    
    if (classAttr) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'attr-name';
      nameSpan.textContent = '.';
      const valSpan = document.createElement('span');
      valSpan.className = 'attr-value';
      valSpan.textContent = classAttr.value.replace(/\s+/g, '.');
      content.appendChild(nameSpan);
      content.appendChild(valSpan);
    }
  }
  
  container.appendChild(content);
  
  // --- Children ---
  if (hasChildren && state.expandedIds.has(node._id)) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'children-container';
    
    // Render Shadow Root first if present
    if (node.shadow) {
      childrenContainer.appendChild(createNodeElement(node.shadow));
    }
    
    // Render Children
    if (node.children) {
      node.children.forEach(child => {
        childrenContainer.appendChild(createNodeElement(child));
      });
    }
    
    container.appendChild(childrenContainer);
  }
  
  return container;
}

// --- JSON Tree Renderer ---
function createJsonTree(data, name = null) {
  const container = document.createElement('div');
  container.className = 'json-entry';

  // Expand button (if object/array)
  const isObject = data !== null && typeof data === 'object';
  const isArray = Array.isArray(data);
  const isMap = isObject && data.__kind === 'Map';
  const isSet = isObject && data.__kind === 'Set';
  const isReactElement = isObject && data.__kind === 'ReactElement';
  
  // Determine if expandable
  let expandable = isObject && !isReactElement; // React elements shown inline-ish or custom
  if (isMap && Object.keys(data.entries).length === 0) expandable = false;
  if (isSet && data.values.length === 0) expandable = false;
  if (isArray && data.length === 0) expandable = false;
  if (isObject && !isMap && !isSet && !isArray && !isReactElement && Object.keys(data).length === 0) expandable = false;

  let childrenContainer;
  let expandBtn;

  if (expandable) {
    expandBtn = document.createElement('span');
    expandBtn.className = 'json-expand-btn';
    expandBtn.textContent = '▶';
    container.appendChild(expandBtn);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'json-expand-btn'; // spacer
    container.appendChild(spacer);
  }

  // Key (Name)
  if (name !== null) {
    const keyEl = document.createElement('span');
    keyEl.className = 'json-key';
    keyEl.textContent = name + ':';
    container.appendChild(keyEl);
  }

  // Value
  const valueEl = document.createElement('span');
  valueEl.className = 'json-value';
  
  if (data === null) {
    valueEl.className += ' json-null';
    valueEl.textContent = 'null';
  } else if (data === undefined) {
    valueEl.className += ' json-undefined';
    valueEl.textContent = 'undefined';
  } else if (typeof data === 'string') {
    valueEl.className += ' json-string';
    valueEl.textContent = `"${data}"`;
  } else if (typeof data === 'number') {
    valueEl.className += ' json-number';
    valueEl.textContent = data;
  } else if (typeof data === 'boolean') {
    valueEl.className += ' json-boolean';
    valueEl.textContent = data;
  } else if (isReactElement) {
    valueEl.className += ' json-react-element';
    valueEl.textContent = `<${data.name} />`;
  } else if (isMap) {
    valueEl.textContent = `Map(${Object.keys(data.entries).length})`;
  } else if (isSet) {
    valueEl.textContent = `Set(${data.values.length})`;
  } else if (isArray) {
    valueEl.textContent = `Array(${data.length})`;
  } else if (typeof data === 'object') {
    valueEl.textContent = '{...}';
  } else {
    valueEl.textContent = String(data);
  }
  
  container.appendChild(valueEl);

  // Children (if expandable)
  if (expandable) {
    childrenContainer = document.createElement('div');
    childrenContainer.className = 'json-children'; // Default hidden by CSS
    
    if (isMap) {
      for (const key in data.entries) {
        childrenContainer.appendChild(createJsonTree(data.entries[key], key));
      }
    } else if (isSet) {
      data.values.forEach((val, idx) => {
        childrenContainer.appendChild(createJsonTree(val, idx));
      });
    } else if (isArray) {
      data.forEach((val, idx) => {
        childrenContainer.appendChild(createJsonTree(val, idx));
      });
    } else {
      for (const key in data) {
        childrenContainer.appendChild(createJsonTree(data[key], key));
      }
    }
    container.appendChild(childrenContainer);
    
    // Click handler
    expandBtn.onclick = (e) => {
      e.stopPropagation();
      expandBtn.classList.toggle('expanded');
      childrenContainer.classList.toggle('visible');
    };
  }

  return container;
}

function renderDetails(details) {
  console.log("[Panel] renderDetails", details);
  const propsContent = document.getElementById('props-content');
  propsContent.innerHTML = '';

  if (!details) {
    propsContent.innerHTML = '<div class="empty-state">No details available.</div>';
    return;
  }

  // --- Props Section ---
  const propsHeader = document.createElement('div');
  propsHeader.className = 'details-header';
  propsHeader.textContent = 'Props';
  propsContent.appendChild(propsHeader);

  const propsContainer = document.createElement('div');
  propsContainer.className = 'json-tree';
  propsContainer.style.padding = '8px';
  
  if (details.react && details.react.props) {
    if (details.react.props.error) {
       propsContainer.textContent = details.react.props.error;
       propsContainer.style.color = 'red';
    } else {
       // Render each prop as a root item
       for (const key in details.react.props) {
         propsContainer.appendChild(createJsonTree(details.react.props[key], key));
       }
       if (Object.keys(details.react.props).length === 0) {
         propsContainer.innerHTML = '<span style="color:#888; font-style:italic;">Empty</span>';
       }
    }
  } else {
    propsContainer.innerHTML = '<span style="color:#888; font-style:italic;">No React props found</span>';
  }
  propsContent.appendChild(propsContainer);

  // --- Hooks Section ---
  if (details.react && details.react.hooks && details.react.hooks.length > 0) {
    const hooksHeader = document.createElement('div');
    hooksHeader.className = 'details-header';
    hooksHeader.textContent = 'Hooks';
    propsContent.appendChild(hooksHeader);

    const hooksContainer = document.createElement('div');
    hooksContainer.className = 'hooks-list';
    hooksContainer.style.padding = '8px';

    details.react.hooks.forEach((hook, index) => {
      const hookEntry = document.createElement('div');
      hookEntry.className = 'hook-entry';

      const header = document.createElement('div');
      header.className = 'hook-header';
      header.innerHTML = `<span class="hook-index">${index + 1}</span> <span class="hook-name">Hook</span>`; 
      hookEntry.appendChild(header);

      const valueContainer = document.createElement('div');
      valueContainer.className = 'hook-value json-tree';
      valueContainer.appendChild(createJsonTree(hook.value, null)); // Value only
      hookEntry.appendChild(valueContainer);

      hooksContainer.appendChild(hookEntry);
    });
    propsContent.appendChild(hooksContainer);
  }

  // --- HTML Attributes Section ---
  if (details.attributes && details.attributes.length > 0) {
    const attrHeader = document.createElement('div');
    attrHeader.className = 'details-header';
    attrHeader.textContent = 'HTML Attributes';
    propsContent.appendChild(attrHeader);
    
    const attrContainer = document.createElement('div');
    attrContainer.className = 'json-tree';
    attrContainer.style.padding = '8px';
    
    details.attributes.forEach(attr => {
      attrContainer.appendChild(createJsonTree(attr.value, attr.name));
    });
    propsContent.appendChild(attrContainer);
  }
}

// --- Actions ---

function selectNode(id) {
  state.selectedId = id;
  renderTree(); // Re-render to update selection highlight
  
  // Show loading state
  propsContent.innerHTML = '<div class="empty-state">Loading details...</div>';
  
  const node = state.nodeMap.get(id);
  if (!node) return;

  chrome.runtime.sendMessage({ 
    action: "get-details", 
    id: id,
    tabId: chrome.devtools.inspectedWindow.tabId 
  }, (details) => {
    if (chrome.runtime.lastError) {
      propsContent.innerHTML = `<div class="empty-state">Error: ${chrome.runtime.lastError.message}</div>`;
      return;
    }
    if (!details || details.error) {
      propsContent.innerHTML = `<div class="empty-state">Error: ${details ? details.error : 'No details received'}</div>`;
      return;
    }
    
    // Merge details into our local node model for caching/display
    node.react = details.react;
    node.attributes = details.attributes;
    
    renderDetails(node);
  });
}

function toggleExpansion(id) {
  if (state.expandedIds.has(id)) {
    state.expandedIds.delete(id);
  } else {
    state.expandedIds.add(id);
  }
  renderTree();
}

// --- Keyboard Navigation ---

document.addEventListener('keydown', (e) => {
  // Only handle navigation if we are not in an input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    
    const visibleNodes = Array.from(document.querySelectorAll('.node-content'));
    if (visibleNodes.length === 0) return;

    // --- Up / Down ---
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      let currentIndex = -1;
      if (state.selectedId) {
        currentIndex = visibleNodes.findIndex(el => el.classList.contains('selected'));
      }

      let nextIndex = currentIndex;

      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex + 1;
        if (nextIndex >= visibleNodes.length) nextIndex = visibleNodes.length - 1;
      } else if (e.key === 'ArrowUp') {
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) nextIndex = 0;
      }

      if (nextIndex !== currentIndex && nextIndex >= 0 && nextIndex < visibleNodes.length) {
        const nextEl = visibleNodes[nextIndex];
        nextEl.click();
        nextEl.scrollIntoView({ block: 'nearest' });
      }
    }
    
    // --- Right (Expand or Enter) ---
    if (e.key === 'ArrowRight') {
      if (state.selectedId) {
        const node = state.nodeMap.get(state.selectedId);
        if (node) {
          const hasChildren = (node.children && node.children.length > 0) || node.shadow;
          if (hasChildren) {
            if (!state.expandedIds.has(state.selectedId)) {
              // Expand
              state.expandedIds.add(state.selectedId);
              renderTree();
            } else {
              // Enter (Select first child)
              let firstChildId = null;
              if (node.shadow) firstChildId = node.shadow._id;
              else if (node.children && node.children.length > 0) firstChildId = node.children[0]._id;
              
              if (firstChildId) {
                selectNode(firstChildId);
                setTimeout(() => {
                   const el = treeRoot.querySelector(`.node-content.selected`);
                   if (el) el.scrollIntoView({ block: 'nearest' });
                }, 0);
              }
            }
          }
        }
      }
    }
    
    // --- Left (Collapse or Leave) ---
    if (e.key === 'ArrowLeft') {
      if (state.selectedId) {
        if (state.expandedIds.has(state.selectedId)) {
          // Collapse
          state.expandedIds.delete(state.selectedId);
          renderTree();
        } else {
          // Leave (Select parent)
          const parts = state.selectedId.split('.');
          if (parts.length > 1) {
            parts.pop();
            const parentId = parts.join('.');
            selectNode(parentId);
            setTimeout(() => {
               const el = treeRoot.querySelector(`.node-content.selected`);
               if (el) el.scrollIntoView({ block: 'nearest' });
            }, 0);
          }
        }
      }
    }
  }
});