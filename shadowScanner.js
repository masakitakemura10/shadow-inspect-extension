/**
 * Shadow DOM Scanner
 * Scans the DOM tree including Shadow Roots, handling circular references and large trees.
 */

// Configuration
const MAX_DEPTH = 20; // Prevent infinite loops in deep trees
const CHUNK_TIME_MS = 10; // Yield to main thread after this time

export const scanShadowRoots = async (root = document.body) => {
  const result = {
    root: null,
    stats: { scanned: 0, shadowRoots: 0 }
  };

  // Use WeakSet to track visited nodes to prevent cycles
  const visited = new WeakSet();
  
  // Serializer to handle circular refs and DOM nodes
  const serialize = (node, depth = 0, path = 'root') => {
    if (!node) return null;
    
    // Basic node info
    const info = {
      _id: path, // Unique ID for selection
      tag: node.tagName ? node.tagName.toLowerCase() : 'text',
      id: node.id || null,
      classes: node.classList ? [...node.classList] : [],
      // Only get attributes for elements
      attributes: node.attributes ? [...node.attributes].map(a => ({ name: a.name, value: a.value })) : [],
      children: [],
      shadow: null
    };

    // Stop if too deep
    if (depth > MAX_DEPTH) {
      info.children = [{ tag: '...max depth reached...', _id: path + '.max' }];
      return info;
    }

    return info;
  };

  // Iterative scanner using a queue to avoid stack overflow
  // We'll build a parallel tree structure
  
  // Initial node
  const rootInfo = serialize(root);
  result.root = rootInfo;

  const queue = [{ domNode: root, infoNode: rootInfo, depth: 0 }];
  
  let startTime = performance.now();

  while (queue.length > 0) {
    // Yield to main thread if taking too long
    if (performance.now() - startTime > CHUNK_TIME_MS) {
      await new Promise(resolve => requestIdleCallback(resolve));
      startTime = performance.now();
    }

    const { domNode, infoNode, depth } = queue.shift();

    if (visited.has(domNode)) continue;
    visited.add(domNode);
    result.stats.scanned++;

    // 1. Check for Shadow Root
    if (domNode.shadowRoot) {
      result.stats.shadowRoots++;
      const shadowInfo = {
        _id: infoNode._id + '.shadow',
        tag: '#shadow-root',
        mode: domNode.shadowRoot.mode,
        children: []
      };
      infoNode.shadow = shadowInfo;
      
      // Add shadow root children to queue
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

    // 2. Check for regular children (Light DOM)
    // Note: If element has shadow root, light DOM children might not be rendered,
    // but we still scan them to show what's "slotted" or available.
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

// Helper to decide if we should scan a node
const shouldScan = (node) => {
  // Currently only scanning Elements for cleaner tree
  return node.nodeType === Node.ELEMENT_NODE;
};
